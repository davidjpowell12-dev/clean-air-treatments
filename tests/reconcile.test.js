// Tests for the books reconciliation report (utils/reconcile.js).
// Seed deliberately-broken data and assert each discrepancy is caught.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');
const { computeReconciliation } = require('../utils/reconcile');

// Insert a paid invoice with arbitrary sync/trace state.
function addPaidInvoice(db, estimateId, opts = {}) {
  const {
    number = 'INV-' + Math.floor(Math.random() * 1e9), amount = 10000,
    paidAt = '2026-05-01T00:00:00Z', method = 'card',
    qboInvoiceId = 'q1', qboPaymentId = 'p1', stripePi = 'pi_1',
    installment = null, total = null, plan = 'monthly',
  } = opts;
  db.prepare(`INSERT INTO invoices
    (invoice_number, estimate_id, amount_cents, status, payment_plan, paid_at,
     payment_method, qbo_invoice_id, qbo_payment_id, stripe_payment_intent_id,
     installment_number, total_installments)
    VALUES (?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(number, estimateId, amount, plan, paidAt, method, qboInvoiceId, qboPaymentId, stripePi, installment, total);
}

test('a fully-consistent book reports clean', () => {
  const db = makeDb();
  const p = addProperty(db, 'Clean');
  const e = addEstimate(db, { propertyId: p, name: 'Clean', plan: 'monthly',
                              method: 'check', totalPrice: 100, monthlyPrice: 100, months: 1 });
  addPaidInvoice(db, e, { amount: 10000, plan: 'monthly', method: 'check', installment: 1, total: 1 });
  const r = computeReconciliation(db, 2026);
  assert.equal(r.summary.clean, true, 'no discrepancies expected');
  assert.equal(r.summary.collected_this_year, 100);
});

test('flags paid invoice not synced to QBO', () => {
  const db = makeDb();
  const p = addProperty(db, 'NoQbo');
  const e = addEstimate(db, { propertyId: p, name: 'NoQbo', plan: 'per_service' });
  addPaidInvoice(db, e, { qboInvoiceId: null, plan: 'per_service' });
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.not_synced_to_qbo.length, 1);
});

test('flags invoice in QBO whose payment was never recorded there', () => {
  const db = makeDb();
  const p = addProperty(db, 'NoPay');
  const e = addEstimate(db, { propertyId: p, name: 'NoPay', plan: 'per_service' });
  addPaidInvoice(db, e, { qboInvoiceId: 'q9', qboPaymentId: null, plan: 'per_service' });
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.payment_not_in_qbo.length, 1);
});

test('flags card payment with no Stripe trace', () => {
  const db = makeDb();
  const p = addProperty(db, 'NoTrace');
  const e = addEstimate(db, { propertyId: p, name: 'NoTrace', plan: 'per_service' });
  addPaidInvoice(db, e, { method: 'card', stripePi: null, plan: 'per_service' });
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.card_paid_no_stripe.length, 1);
});

test('flags paid invoice with no paid_at date', () => {
  const db = makeDb();
  const p = addProperty(db, 'NoDate');
  const e = addEstimate(db, { propertyId: p, name: 'NoDate', plan: 'per_service' });
  db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, paid_at)
              VALUES ('ND-1', ?, 5000, 'paid', 'per_service', NULL)`).run(e);
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.paid_without_date.length, 1);
});

test('flags duplicate installments for the same estimate', () => {
  const db = makeDb();
  const p = addProperty(db, 'Dup');
  const e = addEstimate(db, { propertyId: p, name: 'Dup', plan: 'monthly' });
  addPaidInvoice(db, e, { number: 'D-1a', installment: 1, total: 8 });
  addPaidInvoice(db, e, { number: 'D-1b', installment: 1, total: 8 }); // duplicate #1
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.duplicate_installments.length, 1);
  assert.equal(r.discrepancies.duplicate_installments[0].count, 2);
});

test('flags estimate whose invoiced total does not match (fee-aware)', () => {
  const db = makeDb();
  const p = addProperty(db, 'Mismatch');
  // Estimate says $1000 by check → expects $1000 invoiced. We only invoiced $200.
  const e = addEstimate(db, { propertyId: p, name: 'Mismatch', plan: 'monthly',
                              method: 'check', totalPrice: 1000, monthlyPrice: 125, months: 8 });
  addPaidInvoice(db, e, { amount: 20000, plan: 'monthly', method: 'check', installment: 1, total: 8 });
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.estimate_total_mismatch.length, 1);
  assert.equal(r.discrepancies.estimate_total_mismatch[0].difference, -800); // 200 - 1000
});

test('does NOT flag a correctly-invoiced card estimate (fee included)', () => {
  const db = makeDb();
  const p = addProperty(db, 'OkCard');
  // $1000 by card → expected invoiced = 1000 + 3.5% = 1035. Invoice exactly that.
  const e = addEstimate(db, { propertyId: p, name: 'OkCard', plan: 'full',
                              method: 'card', totalPrice: 1000, monthlyPrice: 0, months: 1 });
  addPaidInvoice(db, e, { amount: 103500, plan: 'full', method: 'card', installment: null, total: null });
  const r = computeReconciliation(db, 2026);
  assert.equal(r.discrepancies.estimate_total_mismatch.length, 0, 'card fee should be accounted for');
});
