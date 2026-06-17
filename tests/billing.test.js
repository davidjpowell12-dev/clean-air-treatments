// Tests for the "visit completed → bill" path (utils/billing.js).
// This is the logic that was duplicated across two routes and caused the
// Amanda Boman double-billing bug; it must behave identically for every plan.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate, addItem, addSchedule, getSchedule, invoicesFor } = require('./helpers');
const { billForCompletedVisit, activateBillingForEstimate } = require('../utils/billing');

test('per_service: exact line-item match creates one invoice at that price (+ card fee)', () => {
  const db = makeDb();
  const p = addProperty(db, 'A');
  const e = addEstimate(db, { propertyId: p, name: 'A', plan: 'per_service', method: 'check' }); // check = no fee
  addItem(db, e, 'Mosquito & Tick Control', 95.5);
  const s = addSchedule(db, { propertyId: p, estimateId: e, serviceType: 'Mosquito & Tick Control' });

  const r = billForCompletedVisit(db, getSchedule(db, s));
  assert.equal(r.action, 'per_service_invoice');
  assert.equal(r.amount, 95.5);
  const invs = invoicesFor(db, e);
  assert.equal(invs.length, 1);
  assert.equal(invs[0].status, 'pending');
  assert.equal(invs[0].amount_cents, 9550);
});

test('per_service: bundled label sums the component line items', () => {
  const db = makeDb();
  const p = addProperty(db, 'B');
  const e = addEstimate(db, { propertyId: p, name: 'B', plan: 'per_service', method: 'check' });
  addItem(db, e, 'Aeration', 120);
  addItem(db, e, 'Seeding', 80);
  addItem(db, e, 'Compost', 50);
  const s = addSchedule(db, { propertyId: p, estimateId: e, serviceType: 'Aeration, Seeding, Compost' });

  const r = billForCompletedVisit(db, getSchedule(db, s));
  assert.equal(r.amount, 250);
  assert.equal(invoicesFor(db, e).length, 1);
});

test('monthly: first completed visit activates installment #1 to pending, no new invoice', () => {
  const db = makeDb();
  const p = addProperty(db, 'C');
  const e = addEstimate(db, { propertyId: p, name: 'C', plan: 'monthly' });
  for (let i = 1; i <= 8; i++) {
    db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, installment_number, total_installments)
                VALUES (?, ?, ?, 'scheduled', 'monthly', ?, 8)`).run('M-' + i, e, 12500, i);
  }
  const s = addSchedule(db, { propertyId: p, estimateId: e });

  const r = billForCompletedVisit(db, getSchedule(db, s));
  assert.equal(r.action, 'activated');
  const invs = invoicesFor(db, e);
  assert.equal(invs.length, 8, 'no extra invoice created');
  assert.equal(invs[0].status, 'pending', 'installment 1 now pending');
});

test('full plan and missing estimate are safe no-ops', () => {
  const db = makeDb();
  const p1 = addProperty(db, 'D');
  const e = addEstimate(db, { propertyId: p1, name: 'D', plan: 'full' });
  const s1 = addSchedule(db, { propertyId: p1, estimateId: e });
  assert.equal(billForCompletedVisit(db, getSchedule(db, s1)).action, 'none');
  assert.equal(invoicesFor(db, e).length, 0);

  const p2 = addProperty(db, 'E');
  const s2 = addSchedule(db, { propertyId: p2, estimateId: null });
  assert.equal(billForCompletedVisit(db, getSchedule(db, s2)).action, 'none');
});

test('activateBillingForEstimate is idempotent — only the FIRST completed visit activates', () => {
  const db = makeDb();
  const p = addProperty(db, 'F');
  const e = addEstimate(db, { propertyId: p, name: 'F', plan: 'monthly' });
  for (let i = 1; i <= 8; i++) {
    db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, installment_number, total_installments)
                VALUES (?, ?, ?, 'scheduled', 'monthly', ?, 8)`).run('M-' + i, e, 12500, i);
  }
  // First completed visit → activates.
  addSchedule(db, { propertyId: p, estimateId: e });
  assert.equal(activateBillingForEstimate(db, e), true);
  // A second completed visit must NOT re-activate (would re-bill).
  addSchedule(db, { propertyId: p, estimateId: e, date: '2026-07-01' });
  assert.equal(activateBillingForEstimate(db, e), false);
});
