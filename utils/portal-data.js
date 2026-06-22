// Read-only data views for the client portal. EVERY query here is scoped to a
// single client_id — this is the security boundary. Internal notes
// (schedules.notes / applications.notes) are deliberately never selected.
const { getClientScope } = require('./clients');

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Invoices the client owns, friendliest-first (action items before paid). */
function getClientInvoices(db, clientId) {
  const rows = db.prepare(`
    SELECT i.invoice_number, i.amount_cents, i.status, i.due_date, i.paid_at,
           i.installment_number, i.total_installments
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE e.client_id = ? AND i.status NOT IN ('void', 'voided')
     ORDER BY i.due_date
  `).all(clientId);

  const today = todayStr();
  const invoices = rows.map(i => {
    let display = i.status;
    if (i.status === 'paid') display = 'paid';
    else if ((i.status === 'pending' || i.status === 'failed') && i.due_date && i.due_date < today) display = 'overdue';
    else if (i.status === 'scheduled') display = 'upcoming';
    else display = 'due';
    return {
      invoice_number: i.invoice_number,
      amount: (i.amount_cents || 0) / 100,
      status: display,
      due_date: i.due_date,
      paid_at: i.paid_at,
      installment: i.installment_number ? `${i.installment_number} of ${i.total_installments}` : null,
    };
  });

  const outstanding = rows
    .filter(i => i.status !== 'paid')
    .reduce((s, i) => s + (i.amount_cents || 0), 0) / 100;

  return { invoices, outstanding };
}

/** Scheduled visits for the client's properties — upcoming and recent. */
function getClientVisits(db, clientId) {
  const { propertyIds } = getClientScope(db, clientId);
  if (propertyIds.length === 0) return { upcoming: [], recent: [] };

  const ph = propertyIds.map(() => '?').join(',');
  // NOTE: intentionally selecting only client-safe columns — never s.notes.
  const rows = db.prepare(`
    SELECT s.scheduled_date, s.service_type, s.status, s.round_number, s.total_rounds, p.address
      FROM schedules s JOIN properties p ON p.id = s.property_id
     WHERE s.property_id IN (${ph})
     ORDER BY s.scheduled_date
  `).all(...propertyIds);

  const today = todayStr();
  const map = (s) => ({
    date: s.scheduled_date,
    service: s.service_type || 'Service',
    status: s.status,
    round: s.round_number ? `${s.round_number} of ${s.total_rounds}` : null,
    address: s.address,
  });

  const upcoming = rows
    .filter(s => s.status !== 'completed' && s.status !== 'skipped' && (!s.scheduled_date || s.scheduled_date >= today))
    .map(map);
  const recent = rows
    .filter(s => s.status === 'completed')
    .sort((a, b) => (b.scheduled_date || '').localeCompare(a.scheduled_date || ''))
    .slice(0, 10)
    .map(map);

  return { upcoming, recent };
}

/** Paid invoices for the client — payment history, newest first, with a
 *  receipt link to the existing public receipt page when a token exists. */
function getClientPayments(db, clientId) {
  const rows = db.prepare(`
    SELECT i.invoice_number, i.amount_cents, i.paid_at, i.payment_method, i.token
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE e.client_id = ? AND i.status = 'paid'
     ORDER BY i.paid_at DESC, i.id DESC
  `).all(clientId);

  const methodLabel = (m) => ({ card: 'Card', ach: 'Bank transfer', check: 'Check' }[m] || (m ? m : '—'));

  const payments = rows.map(i => ({
    invoice_number: i.invoice_number,
    amount: (i.amount_cents || 0) / 100,
    paid_at: i.paid_at ? i.paid_at.slice(0, 10) : null,
    method: methodLabel(i.payment_method),
    receipt_url: i.token ? `/receipt/${i.token}` : null,
  }));

  const totalPaid = rows.reduce((s, i) => s + (i.amount_cents || 0), 0) / 100;
  return { payments, totalPaid };
}

/** Published observation/recommendation notes for the client, newest first.
 *  Only published = 1 notes are ever returned (drafts stay staff-only). */
function getClientNotes(db, clientId) {
  const rows = db.prepare(`
    SELECT title, body, recommendation, created_at
      FROM client_notes
     WHERE client_id = ? AND published = 1
     ORDER BY created_at DESC, id DESC
  `).all(clientId);

  return {
    notes: rows.map(n => ({
      title: n.title || null,
      body: n.body,
      recommendation: n.recommendation || null,
      date: n.created_at ? n.created_at.slice(0, 10) : null,
    })),
  };
}

module.exports = { getClientInvoices, getClientVisits, getClientPayments, getClientNotes };
