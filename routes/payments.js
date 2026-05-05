const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');
const stripeUtils = require('../utils/stripe');
const email = require('../utils/email');

const router = express.Router();

// ─── Admin Endpoints (requireAuth) ───────────────────────────

// List all invoices with optional filters
router.get('/invoices', requireAuth, (req, res) => {
  const db = getDb();
  const { status, estimate_id, due_from, due_to } = req.query;

  let sql = `
    SELECT i.*,
      e.customer_name, e.address, e.city, e.email as customer_email, e.phone as customer_phone,
      e.token as estimate_token,
      e.payment_method_preference as preferred_method,
      e.stripe_customer_id
    FROM invoices i
    JOIN estimates e ON i.estimate_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND i.status = ?';
    params.push(status);
  }
  if (estimate_id) {
    sql += ' AND i.estimate_id = ?';
    params.push(estimate_id);
  }
  if (due_from) {
    sql += ' AND i.due_date >= ?';
    params.push(due_from);
  }
  if (due_to) {
    sql += ' AND i.due_date <= ?';
    params.push(due_to);
  }

  sql += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Get single invoice detail
router.get('/invoices/:id', requireAuth, (req, res) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*,
      e.customer_name, e.address, e.city, e.state, e.zip,
      e.email as customer_email, e.phone as customer_phone,
      e.token as estimate_token, e.total_price as estimate_total,
      e.payment_months, e.property_sqft,
      e.stripe_customer_id, e.payment_method_preference
    FROM invoices i
    JOIN estimates e ON i.estimate_id = e.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Get sibling invoices (same estimate) for context
  const siblings = db.prepare(`
    SELECT id, invoice_number, amount_cents, status, installment_number, total_installments, due_date, paid_at
    FROM invoices WHERE estimate_id = ? ORDER BY installment_number, created_at
  `).all(invoice.estimate_id);

  invoice.related_invoices = siblings;
  res.json(invoice);
});

// Mark that we've sent the customer their invoice link via SMS. Used
// by the Invoicing First Round queue so a row can flip from "Unsent"
// to "Sent" once you've opened SMS for it. Idempotent — calling twice
// just refreshes the timestamp.
router.post('/invoices/:id/mark-sent', requireAuth, (req, res) => {
  const db = getDb();
  const inv = db.prepare('SELECT id, invoice_number FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });

  const now = new Date().toISOString();
  db.prepare('UPDATE invoices SET sms_sent_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(now, req.params.id);

  logAudit(db, 'invoice', inv.id, req.session.userId, 'sms_sent', {
    invoice_number: inv.invoice_number, sent_at: now
  });

  res.json({ success: true, sms_sent_at: now });
});

// Record a check payment
router.post('/invoices/:id/record-check', requireAuth, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });
  if (invoice.status === 'void') return res.status(400).json({ error: 'Invoice is voided' });

  const { check_number, check_date, notes } = req.body;

  db.prepare(`
    UPDATE invoices SET
      status = 'paid', payment_method = 'check', paid_at = ?,
      check_number = ?, check_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(new Date().toISOString(), check_number || null, check_date || null, notes || null, invoice.id);

  logAudit(db, 'invoice', invoice.id, req.session.userId, 'check_payment', {
    invoice_number: invoice.invoice_number, check_number, amount_cents: invoice.amount_cents
  });

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  res.json(updated);
});

// Void an unpaid invoice
// Public receipt data endpoint — no auth, token-scoped.
// Returns enough info for the receipt page: invoice details, customer info,
// and the business's messaging settings (for header branding).
router.get('/public/receipt/:token', (req, res) => {
  const db = getDb();
  const inv = db.prepare(`
    SELECT i.*, e.customer_name, e.address, e.city, e.state, e.zip,
           e.email, e.phone, e.payment_method_preference
    FROM invoices i
    LEFT JOIN estimates e ON e.id = i.estimate_id
    WHERE i.token = ?
  `).get(req.params.token);
  if (!inv) return res.status(404).json({ error: 'Receipt not found' });

  // Pull business branding from app_settings (falls back to defaults)
  const settings = {};
  const rows = db.prepare(
    "SELECT key, value FROM app_settings WHERE key LIKE 'msg_%'"
  ).all();
  for (const r of rows) settings[r.key] = r.value;

  // For unpaid invoices where the estimate prefers check, surface payment
  // instructions so the customer knows how to mail the check.
  const isCheck = (inv.payment_method_preference || '').toLowerCase() === 'check';

  res.json({
    invoice_number: inv.invoice_number,
    amount_dollars: (inv.amount_cents / 100).toFixed(2),
    status: inv.status,
    due_date: inv.due_date,
    paid_at: inv.paid_at,
    payment_method: inv.payment_method,
    payment_method_preference: inv.payment_method_preference,
    check_number: inv.check_number,
    payment_plan: inv.payment_plan,
    installment_number: inv.installment_number,
    total_installments: inv.total_installments,
    notes: inv.notes,
    customer: {
      name: inv.customer_name,
      address: inv.address,
      city: inv.city,
      state: inv.state,
      zip: inv.zip
    },
    business: {
      name: settings.msg_business_name || 'Clean Air Lawn Care',
      review_link: settings.msg_review_link || ''
    },
    // Tell the page whether to render the "Pay with Card" button. Showing
    // it when Stripe isn't configured would just produce a confusing error.
    stripe_enabled: stripeUtils.isEnabled(),
    payment_instructions: isCheck && inv.status !== 'paid' ? {
      payable_to: settings.msg_payable_to || '',
      mailing_address: settings.msg_mailing_address || '',
      notes: settings.msg_payment_notes || ''
    } : null
  });
});

// Public checkout endpoint — no auth, scoped to a single invoice via its
// token. Used by the receipt page's "Pay with Card" button so customers
// can opt to pay online regardless of the estimate's preferred method
// (e.g. a check-preferred customer who decides to pay by card this time).
router.post('/public/checkout/:token', async (req, res) => {
  const db = getDb();
  const inv = db.prepare(`
    SELECT i.*, e.customer_name, e.email, e.stripe_customer_id, e.payment_plan, e.token as estimate_token
    FROM invoices i
    JOIN estimates e ON e.id = i.estimate_id
    WHERE i.token = ?
  `).get(req.params.token);

  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });
  if (inv.status === 'void') return res.status(400).json({ error: 'Invoice is voided' });

  if (!stripeUtils.isEnabled()) {
    return res.status(503).json({ error: 'Card payments are not configured' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    const session = await stripeUtils.createCheckoutSession({
      invoiceId: inv.id,
      invoiceNumber: inv.invoice_number,
      amountCents: inv.amount_cents,
      customerName: inv.customer_name,
      customerEmail: inv.email,
      stripeCustomerId: inv.stripe_customer_id || undefined,
      // Stay on the receipt page on either path; success will be reflected
      // when the webhook flips the invoice status to "paid".
      successUrl: `${baseUrl}/receipt/${inv.token}?paid=1`,
      cancelUrl: `${baseUrl}/receipt/${inv.token}`,
      // Save the card if the customer is on an ongoing plan, so future
      // installments can auto-charge without making them re-enter the card.
      savePaymentMethod: inv.payment_plan === 'monthly' || inv.payment_plan === 'per_service'
    });

    db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(session.id, inv.id);

    res.json({ url: session.url });
  } catch (err) {
    console.error('[payments] Public checkout failed:', err.message);
    res.status(500).json({ error: 'Could not start payment: ' + err.message });
  }
});

router.post('/invoices/:id/void', requireAuth, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Cannot void a paid invoice' });

  db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('void', invoice.id);

  logAudit(db, 'invoice', invoice.id, req.session.userId, 'void', {
    invoice_number: invoice.invoice_number
  });

  res.json({ success: true, invoice_number: invoice.invoice_number });
});

// General-purpose invoice edit. Accepts any subset of editable fields and
// updates them. Used for one-off corrections (amount mis-billed, status
// needs manual flip, notes, payment method). Any field omitted from the
// body is left alone.
router.put('/invoices/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const b = req.body || {};
  const next = {
    amount_cents: b.amount_cents !== undefined ? Number(b.amount_cents) : existing.amount_cents,
    status: b.status !== undefined ? b.status : existing.status,
    due_date: b.due_date !== undefined ? b.due_date : existing.due_date,
    paid_at: b.paid_at !== undefined ? b.paid_at : existing.paid_at,
    payment_method: b.payment_method !== undefined ? b.payment_method : existing.payment_method,
    check_number: b.check_number !== undefined ? b.check_number : existing.check_number,
    check_date: b.check_date !== undefined ? b.check_date : existing.check_date,
    notes: b.notes !== undefined ? b.notes : existing.notes
  };

  // If newly marked paid and no paid_at supplied, stamp today
  if (next.status === 'paid' && !next.paid_at) {
    next.paid_at = new Date().toISOString();
  }

  db.prepare(`
    UPDATE invoices SET
      amount_cents = ?, status = ?, due_date = ?, paid_at = ?,
      payment_method = ?, check_number = ?, check_date = ?, notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    next.amount_cents, next.status, next.due_date, next.paid_at,
    next.payment_method, next.check_number, next.check_date, next.notes,
    req.params.id
  );

  logAudit(db, 'invoice', existing.id, req.session.userId, 'update', {
    invoice_number: existing.invoice_number, before: existing, after: next
  });

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Hard delete an invoice. Audited. Use Void for paid invoices instead of
// delete; this is for correcting mistakes (duplicate invoice, wrong client, etc).
router.delete('/invoices/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  logAudit(db, 'invoice', existing.id, req.session.userId, 'delete', {
    invoice_number: existing.invoice_number,
    amount_cents: existing.amount_cents, status: existing.status
  });

  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Manually charge a specific invoice (card on file)
router.post('/invoices/:id/charge', requireAuth, async (req, res) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*, e.customer_name, e.email, e.stripe_customer_id, e.payment_method_preference
    FROM invoices i JOIN estimates e ON i.estimate_id = e.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });
  if (invoice.status === 'void') return res.status(400).json({ error: 'Invoice is voided' });
  if (!invoice.stripe_customer_id) {
    return res.status(400).json({ error: 'No Stripe customer linked. Customer needs to save a card first.' });
  }

  try {
    const stripeUtils = require('../utils/stripe');
    const result = await stripeUtils.chargeCustomer(
      invoice.stripe_customer_id,
      invoice.amount_cents,
      invoice.invoice_number,
      `${invoice.customer_name} — Clean Air Lawn Care`
    );

    if (!result) {
      return res.status(400).json({ error: 'No payment method on file. Send a payment link instead.' });
    }

    // Mark invoice as paid
    db.prepare(`
      UPDATE invoices SET status = 'paid', paid_at = ?, payment_method = 'card',
        stripe_payment_intent_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(new Date().toISOString(), result.id, invoice.id);

    logAudit(db, 'invoice', invoice.id, req.session.userId, 'manual_charge', {
      invoice_number: invoice.invoice_number,
      amount_cents: invoice.amount_cents,
      payment_intent: result.id
    });

    console.log(`[charge] Manual charge SUCCESS: ${invoice.invoice_number} $${(invoice.amount_cents / 100).toFixed(2)} for ${invoice.customer_name}`);
    res.json({ success: true, payment_intent_id: result.id, invoice_number: invoice.invoice_number });
  } catch (err) {
    // Mark as failed so it shows up in the failed filter
    db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('failed', invoice.id);

    logAudit(db, 'invoice', invoice.id, req.session.userId, 'charge_failed', {
      invoice_number: invoice.invoice_number,
      error: err.message
    });

    console.error(`[charge] Manual charge FAILED: ${invoice.invoice_number}:`, err.message);
    res.status(400).json({ error: `Charge failed: ${err.message}` });
  }
});

// Send payment request email with Stripe Checkout link
router.post('/invoices/:id/send-payment-request', requireAuth, async (req, res) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*, e.customer_name, e.email, e.token as estimate_token, e.stripe_customer_id
    FROM invoices i JOIN estimates e ON i.estimate_id = e.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!invoice.email) return res.status(400).json({ error: 'No customer email on this estimate' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    // Create Stripe Checkout session
    let checkoutUrl = null;
    if (stripeUtils.isEnabled()) {
      const session = await stripeUtils.createCheckoutSession({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        amountCents: invoice.amount_cents,
        customerName: invoice.customer_name,
        customerEmail: invoice.email,
        stripeCustomerId: invoice.stripe_customer_id || undefined,
        successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/proposal/${invoice.estimate_token}`,
        savePaymentMethod: invoice.payment_plan === 'per_service'
      });

      // Store session ID on invoice
      db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(session.id, invoice.id);

      checkoutUrl = session.url;
    }

    // Send email with payment link
    if (email.isEnabled()) {
      await email.sendInvoiceEmail({
        to: invoice.email,
        customerName: invoice.customer_name,
        invoiceNumber: invoice.invoice_number,
        amount: (invoice.amount_cents / 100).toFixed(2),
        dueDate: invoice.due_date,
        paymentUrl: checkoutUrl || `${baseUrl}/proposal/${invoice.estimate_token}`
      });
    }

    logAudit(db, 'invoice', invoice.id, req.session.userId, 'payment_request_sent', {
      invoice_number: invoice.invoice_number, to: invoice.email
    });

    res.json({ success: true, message: `Payment request sent to ${invoice.email}` });
  } catch (err) {
    console.error('[payments] Send payment request failed:', err.message);
    res.status(500).json({ error: 'Failed to send payment request. ' + err.message });
  }
});

// ─── Reusable auto-charge logic (called by route AND daily cron) ───
async function processDueInvoices(options = {}) {
  const { sendEmailOnNoMethod = true } = options;

  if (!stripeUtils.isEnabled()) {
    return { success: false, error: 'Stripe not configured' };
  }

  const db = getDb();

  // Kill-switch: respect the cron_paused setting so admin can freeze auto-charge
  // while reviewing/cleaning invoices without surprises at 8 AM.
  const pausedRow = db.prepare("SELECT value FROM app_settings WHERE key = 'cron_paused'").get();
  if (pausedRow && pausedRow.value === 'true') {
    console.log('[cron] Auto-charge PAUSED via cron_paused setting — skipping run');
    return { paused: true, charged: 0, failed: 0, no_method: 0, skipped: 0 };
  }

  const today = new Date().toISOString().split('T')[0];

  // Find pending invoices that are due today or overdue, with a Stripe customer on file
  const dueInvoices = db.prepare(`
    SELECT i.*, e.stripe_customer_id, e.customer_name, e.email, e.token as estimate_token
    FROM invoices i
    JOIN estimates e ON i.estimate_id = e.id
    WHERE i.status = 'pending'
      AND i.due_date <= ?
      AND e.stripe_customer_id IS NOT NULL
    ORDER BY i.due_date ASC
  `).all(today);

  const results = { charged: 0, failed: 0, no_method: 0, skipped: 0, errors: [] };

  for (const inv of dueInvoices) {
    try {
      const result = await stripeUtils.chargeCustomer(
        inv.stripe_customer_id,
        inv.amount_cents,
        inv.invoice_number,
        `Clean Air Lawn Care — ${inv.customer_name}`
      );

      if (!result) {
        // No saved payment method
        results.no_method++;

        if (sendEmailOnNoMethod && email.isEnabled() && inv.email) {
          const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : 'https://clean-air-treatments-production.up.railway.app';

          try {
            const session = await stripeUtils.createCheckoutSession({
              invoiceId: inv.id,
              invoiceNumber: inv.invoice_number,
              amountCents: inv.amount_cents,
              customerName: inv.customer_name,
              customerEmail: inv.email,
              stripeCustomerId: inv.stripe_customer_id,
              successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${baseUrl}/proposal/${inv.estimate_token}`,
              savePaymentMethod: true
            });

            db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(session.id, inv.id);

            await email.sendInvoiceEmail({
              to: inv.email,
              customerName: inv.customer_name,
              invoiceNumber: inv.invoice_number,
              amount: (inv.amount_cents / 100).toFixed(2),
              dueDate: inv.due_date,
              paymentUrl: session.url
            });
          } catch (emailErr) {
            console.error(`[auto-charge] Email fallback failed for ${inv.invoice_number}:`, emailErr.message);
          }
        } else if (!sendEmailOnNoMethod) {
          results.skipped++;
          console.log(`[auto-charge] ${inv.invoice_number} skipped — no saved payment method`);
        }
        continue;
      }

      // Payment succeeded
      db.prepare(`
        UPDATE invoices SET
          status = 'paid', paid_at = ?, payment_method = 'card',
          stripe_payment_intent_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(new Date().toISOString(), result.id, inv.id);

      logAudit(db, 'invoice', inv.id, null, 'auto_charged', {
        invoice_number: inv.invoice_number, amount_cents: inv.amount_cents,
        payment_intent: result.id
      });

      // Send receipt
      if (email.isEnabled() && inv.email) {
        email.sendPaymentConfirmationEmail({
          to: inv.email,
          customerName: inv.customer_name,
          invoiceNumber: inv.invoice_number,
          amount: (inv.amount_cents / 100).toFixed(2),
          paymentMethod: 'card'
        }).catch(err => console.error('[auto-charge] Receipt email failed:', err.message));
      }

      results.charged++;
      console.log(`[auto-charge] ${inv.invoice_number} charged $${(inv.amount_cents / 100).toFixed(2)}`);

    } catch (err) {
      results.failed++;
      results.errors.push({ invoice: inv.invoice_number, error: err.message });

      // Mark as failed
      db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('failed', inv.id);

      console.error(`[auto-charge] ${inv.invoice_number} failed:`, err.message);
    }
  }

  console.log(`[auto-charge] Complete — ${results.charged} charged, ${results.failed} failed, ${results.no_method} no method, ${results.skipped} skipped`);
  return { success: true, total_due: dueInvoices.length, ...results };
}

// Auto-charge due invoices (called by scheduled job or manually)
router.post('/process-due-invoices', requireAuth, async (req, res) => {
  const result = await processDueInvoices({ sendEmailOnNoMethod: true });
  if (!result.success) {
    return res.status(503).json({ error: result.error });
  }
  res.json(result);
});

// Dashboard summary stats
router.get('/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisYear = String(now.getFullYear());
  const today = now.toISOString().split('T')[0];

  const stats = {
    // Outstanding = everything that hasn't been paid yet, including future
    // scheduled monthly installments. This matches the user's mental model
    // of "what's still in the pipeline to collect."
    total_outstanding_cents: db.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices WHERE status IN ('pending', 'failed', 'scheduled')"
    ).get().total,
    total_collected_month_cents: db.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices WHERE status = 'paid' AND paid_at LIKE ? || '%'"
    ).get(thisMonth).total,
    total_collected_year_cents: db.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices WHERE status = 'paid' AND paid_at LIKE ? || '%'"
    ).get(thisYear).total,
    overdue_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'pending' AND due_date < ?"
    ).get(today).count,
    pending_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status IN ('pending', 'failed')"
    ).get().count,
    paid_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'paid'"
    ).get().count,
    failed_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'failed'"
    ).get().count,
    scheduled_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'scheduled'"
    ).get().count
  };

  res.json(stats);
});

// ─── Duplicate Invoice Diagnostic ────────────────────────────
// One-time admin tool: finds estimates that have more than one installment_number=1
// invoice, which indicates the invoice set was created more than once.
router.get('/diag/duplicate-invoices', requireAuth, (req, res) => {
  const db = getDb();

  const dupes = db.prepare(`
    SELECT
      e.id          AS estimate_id,
      e.customer_name,
      e.payment_plan,
      COUNT(i.id)   AS total_invoices,
      COUNT(CASE WHEN i.installment_number = 1 THEN 1 END) AS first_installment_count,
      COUNT(CASE WHEN i.installment_number IS NULL THEN 1 END) AS null_installment_count,
      SUM(i.amount_cents) AS total_amount_cents,
      SUM(CASE WHEN i.status = 'paid'  THEN i.amount_cents ELSE 0 END) AS paid_cents,
      SUM(CASE WHEN i.status NOT IN ('paid','void') THEN i.amount_cents ELSE 0 END) AS outstanding_cents,
      GROUP_CONCAT(i.invoice_number || ':' || i.status || ':' || COALESCE(i.installment_number,'null'), '|') AS invoice_summary
    FROM estimates e
    JOIN invoices i ON i.estimate_id = e.id
    GROUP BY e.id
    HAVING first_installment_count > 1
    ORDER BY e.customer_name
  `).all();

  const totalInflatedCents = dupes.reduce((s, d) => s + (d.outstanding_cents || 0), 0);

  res.json({
    affected_estimates: dupes.length,
    total_inflated_outstanding: (totalInflatedCents / 100).toFixed(2),
    duplicates: dupes.map(d => ({
      ...d,
      total_dollars: (d.total_amount_cents / 100).toFixed(2),
      paid_dollars: (d.paid_cents / 100).toFixed(2),
      outstanding_dollars: (d.outstanding_cents / 100).toFixed(2),
    }))
  });
});

// ─── Public Endpoints (no auth) ──────────────────────────────

// Create Stripe Checkout session for a customer paying an invoice
router.post('/create-checkout/:token', async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE token = ?').get(req.params.token);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND estimate_id = ?')
    .get(invoice_id, est.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });

  if (!stripeUtils.isEnabled()) {
    return res.status(503).json({ error: 'Payment processing is not configured' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    const session = await stripeUtils.createCheckoutSession({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amountCents: invoice.amount_cents,
      customerName: est.customer_name,
      customerEmail: est.email,
      stripeCustomerId: est.stripe_customer_id || undefined,
      successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/proposal/${est.token}`,
      savePaymentMethod: est.payment_plan === 'monthly' || est.payment_plan === 'per_service'
    });

    // Store session ID on invoice
    db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(session.id, invoice.id);

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[payments] Checkout session creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// ─── Stripe Webhook Handler ──────────────────────────────────
// Exported separately — mounted with express.raw() in server.js
async function webhookHandler(req, res) {
  const db = getDb();
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripeUtils.constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const invoiceId = session.metadata?.invoice_id;
        if (!invoiceId) break;

        const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(invoiceId));
        if (!invoice || invoice.status === 'paid') break;

        // Determine payment method type
        let paymentMethod = 'card';
        if (session.payment_method_types?.includes('us_bank_account') &&
            session.payment_method_collection === 'if_required') {
          paymentMethod = 'ach';
        }

        // Mark invoice as paid
        db.prepare(`
          UPDATE invoices SET
            status = 'paid', paid_at = ?, payment_method = ?,
            stripe_payment_intent_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          new Date().toISOString(),
          paymentMethod,
          session.payment_intent || null,
          invoice.id
        );

        // Save Stripe customer ID on the estimate for future auto-charges
        if (session.customer) {
          db.prepare('UPDATE estimates SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?')
            .run(session.customer, invoice.estimate_id);
        }

        // Save payment method as default on the Stripe customer for auto-charges
        if (session.customer && session.payment_intent) {
          try {
            const stripe = require('stripe')(stripeUtils.getStripeKey());
            const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
            if (pi.payment_method) {
              await stripe.customers.update(session.customer, {
                invoice_settings: { default_payment_method: pi.payment_method }
              });
              console.log(`[webhook] Saved payment method ${pi.payment_method} for customer ${session.customer}`);
            }
          } catch (pmErr) {
            console.error('[webhook] Failed to save payment method:', pmErr.message);
          }
        }

        logAudit(db, 'invoice', invoice.id, null, 'paid_via_stripe', {
          invoice_number: invoice.invoice_number,
          amount_cents: invoice.amount_cents,
          payment_intent: session.payment_intent
        });

        // Send payment confirmation email
        if (email.isEnabled()) {
          const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(invoice.estimate_id);
          if (est?.email) {
            email.sendPaymentConfirmationEmail({
              to: est.email,
              customerName: est.customer_name,
              invoiceNumber: invoice.invoice_number,
              amount: (invoice.amount_cents / 100).toFixed(2),
              paymentMethod
            }).catch(err => console.error('[webhook] Receipt email failed:', err.message));
          }
        }

        console.log(`[webhook] Invoice ${invoice.invoice_number} paid via ${paymentMethod}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        // Find invoice by payment intent
        const invoice = db.prepare(
          'SELECT * FROM invoices WHERE stripe_payment_intent_id = ?'
        ).get(pi.id);

        if (invoice) {
          db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('failed', invoice.id);
          console.log(`[webhook] Invoice ${invoice.invoice_number} payment failed`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[webhook] Processing error:', err.message);
  }

  // Always return 200 to acknowledge receipt
  res.json({ received: true });
}

router.webhookHandler = webhookHandler;
router.processDueInvoices = processDueInvoices;
module.exports = router;
