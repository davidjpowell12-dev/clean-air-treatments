// Tests for the portal's read-only data views (utils/portal-data.js).
// Reasserts the security boundary at the data layer and checks that internal
// schedule notes never appear in the visit payload.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');
const { backfillClients } = require('../utils/clients');
const { getClientInvoices, getClientVisits, getClientPayments } = require('../utils/portal-data');

function setupTwoClients(db) {
  const pa = addProperty(db, 'Alice', '1 A St');
  const ea = addEstimate(db, { propertyId: pa, name: 'Alice', plan: 'monthly' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('alice@x.com', ea);
  const pb = addProperty(db, 'Bob', '2 B St');
  const eb = addEstimate(db, { propertyId: pb, name: 'Bob', plan: 'monthly' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('bob@x.com', eb);
  backfillClients(db);
  const aId = db.prepare("SELECT id FROM clients WHERE email='alice@x.com'").get().id;
  const bId = db.prepare("SELECT id FROM clients WHERE email='bob@x.com'").get().id;
  return { pa, ea, aId, pb, eb, bId };
}

function addInvoice(db, estimateId, { number, amount = 10000, status = 'pending', due = '2026-07-01', paidAt = null }) {
  db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, due_date, paid_at)
              VALUES (?, ?, ?, ?, 'monthly', ?, ?)`).run(number, estimateId, amount, status, due, paidAt);
}

test('getClientInvoices returns only the client\'s invoices, with outstanding total', () => {
  const db = makeDb();
  const { ea, aId, eb } = setupTwoClients(db);
  addInvoice(db, ea, { number: 'A-1', amount: 10000, status: 'pending' });
  addInvoice(db, ea, { number: 'A-2', amount: 5000, status: 'paid', paidAt: '2026-05-01' });
  addInvoice(db, eb, { number: 'B-1', amount: 99999, status: 'pending' }); // Bob's — must not appear

  const { invoices, outstanding } = getClientInvoices(db, aId);
  const numbers = invoices.map(i => i.invoice_number).sort();
  assert.deepEqual(numbers, ['A-1', 'A-2']);
  assert.ok(!numbers.includes('B-1'), 'must not see other client invoice');
  assert.equal(outstanding, 100, 'only the unpaid A-1 counts');
});

test('getClientInvoices hides voided and computes overdue/upcoming', () => {
  const db = makeDb();
  const { ea, aId } = setupTwoClients(db);
  addInvoice(db, ea, { number: 'V', amount: 1000, status: 'void' });
  addInvoice(db, ea, { number: 'OD', amount: 1000, status: 'pending', due: '2000-01-01' });
  addInvoice(db, ea, { number: 'SCH', amount: 1000, status: 'scheduled', due: '2099-01-01' });

  const { invoices } = getClientInvoices(db, aId);
  const byNum = Object.fromEntries(invoices.map(i => [i.invoice_number, i.status]));
  assert.equal(byNum['V'], undefined, 'voided hidden');
  assert.equal(byNum['OD'], 'overdue');
  assert.equal(byNum['SCH'], 'upcoming');
});

test('getClientVisits is scoped and NEVER exposes internal notes', () => {
  const db = makeDb();
  const { pa, aId, pb } = setupTwoClients(db);
  db.prepare(`INSERT INTO schedules (property_id, scheduled_date, service_type, status, notes)
              VALUES (?, '2099-01-01', 'Fert & Weed', 'scheduled', 'GATE CODE 1234 - INTERNAL')`).run(pa);
  db.prepare(`INSERT INTO schedules (property_id, scheduled_date, service_type, status)
              VALUES (?, '2025-04-01', 'Mosquito', 'completed')`).run(pa);
  db.prepare(`INSERT INTO schedules (property_id, scheduled_date, service_type, status)
              VALUES (?, '2099-02-02', 'Bob Visit', 'scheduled')`).run(pb); // Bob's

  const { upcoming, recent } = getClientVisits(db, aId);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].service, 'Fert & Weed');
  assert.equal(recent.length, 1);
  assert.equal(recent[0].service, 'Mosquito');
  // No field anywhere should contain the internal note.
  const serialized = JSON.stringify({ upcoming, recent });
  assert.ok(!serialized.includes('GATE CODE'), 'internal notes must never leak to the portal');
  assert.ok(!serialized.includes('Bob Visit'), 'must not see another client\'s visit');
});

test('getClientPayments returns only the client\'s paid invoices, with receipt links', () => {
  const db = makeDb();
  const { ea, aId, eb } = setupTwoClients(db);
  // Alice: one paid (with token → receipt), one unpaid (excluded)
  db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, payment_method, paid_at, token)
              VALUES ('A-PAID', ?, 12950, 'paid', 'monthly', 'card', '2026-05-01T12:00:00Z', 'tok-abc')`).run(ea);
  db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, due_date)
              VALUES ('A-DUE', ?, 12950, 'pending', 'monthly', '2026-06-01')`).run(ea);
  // Bob: paid — must NOT appear for Alice
  db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, payment_method, paid_at)
              VALUES ('B-PAID', ?, 9999, 'paid', 'monthly', 'check', '2026-05-02T12:00:00Z')`).run(eb);

  const { payments, totalPaid } = getClientPayments(db, aId);
  assert.equal(payments.length, 1, 'only the one paid invoice');
  assert.equal(payments[0].invoice_number, 'A-PAID');
  assert.equal(payments[0].method, 'Card');
  assert.equal(payments[0].receipt_url, '/receipt/tok-abc');
  assert.equal(totalPaid, 129.5);
  assert.ok(!payments.some(p => p.invoice_number === 'B-PAID'), 'must not see other client payment');
});

test('a client with no records gets empty, not an error', () => {
  const db = makeDb();
  const { aId } = setupTwoClients(db);
  const lonelyId = db.prepare("INSERT INTO clients (email,name) VALUES ('z@z.com','Z')").run().lastInsertRowid;
  const inv = getClientInvoices(db, lonelyId);
  const vis = getClientVisits(db, lonelyId);
  assert.deepEqual(inv.invoices, []);
  assert.equal(inv.outstanding, 0);
  assert.deepEqual(vis.upcoming, []);
});
