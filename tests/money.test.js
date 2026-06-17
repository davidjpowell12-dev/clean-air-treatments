// Tests for the core money math in utils/stripe.js — card fee and the
// installment/invoice generation that turns an accepted estimate into bills.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate, addItem, invoicesFor } = require('./helpers');
const stripe = require('../utils/stripe');

test('applyCardFee adds 3.5% for card and nothing for check', () => {
  assert.equal(stripe.applyCardFee(10000, 'card'), 10350);  // +3.5%
  assert.equal(stripe.applyCardFee(10000, 'check'), 10000); // unchanged
  assert.equal(stripe.applyCardFee(9550, 'card'), Math.round(9550 * 1.035));
  assert.equal(stripe.CARD_FEE_RATE, 0.035);
});

test('full plan creates a single pending invoice with the card fee applied', () => {
  const db = makeDb();
  const p = addProperty(db, 'Full');
  const e = addEstimate(db, { propertyId: p, name: 'Full', plan: 'full', method: 'card', totalPrice: 1000 });
  const created = stripe.createInvoicesForEstimate(db, e, 'full', 'card');

  assert.equal(created.length, 1);
  assert.equal(created[0].status, 'pending');
  assert.equal(created[0].amount_cents, 103500); // 1000.00 + 3.5%
});

test('monthly plan: N installments, first due today as scheduled, sum equals total-with-fee', () => {
  const db = makeDb();
  const p = addProperty(db, 'Monthly');
  const e = addEstimate(db, { propertyId: p, name: 'Monthly', plan: 'monthly',
                              method: 'card', totalPrice: 1000, monthlyPrice: 125, months: 8 });
  const created = stripe.createInvoicesForEstimate(db, e, 'monthly', 'card');

  assert.equal(created.length, 8);
  assert.ok(created.every(i => i.status === 'scheduled'), 'all start scheduled');
  assert.equal(created[0].installment_number, 1);

  // The last installment absorbs rounding so the total ties out exactly.
  const sum = created.reduce((s, i) => s + i.amount_cents, 0);
  assert.equal(sum, stripe.applyCardFee(100000, 'card'), 'installments sum to total + fee');
});

test('monthly plan by check has no card fee baked in', () => {
  const db = makeDb();
  const p = addProperty(db, 'Check');
  const e = addEstimate(db, { propertyId: p, name: 'Check', plan: 'monthly',
                              method: 'check', totalPrice: 1000, monthlyPrice: 125, months: 8 });
  const created = stripe.createInvoicesForEstimate(db, e, 'monthly', 'check');
  const sum = created.reduce((s, i) => s + i.amount_cents, 0);
  assert.equal(sum, 100000, 'no fee for check payers');
});

test('per_service plan creates no invoices up front', () => {
  const db = makeDb();
  const p = addProperty(db, 'PS');
  const e = addEstimate(db, { propertyId: p, name: 'PS', plan: 'per_service' });
  const created = stripe.createInvoicesForEstimate(db, e, 'per_service', 'card');
  assert.equal(created.length, 0);
  assert.equal(invoicesFor(db, e).length, 0);
});

test('createPerServiceInvoice applies the card fee for card payers', () => {
  const db = makeDb();
  const p = addProperty(db, 'PSfee');
  const e = addEstimate(db, { propertyId: p, name: 'PSfee', plan: 'per_service', method: 'card' });
  const inv = stripe.createPerServiceInvoice(db, e, 10000, 'One-off job');
  assert.equal(inv.amount_cents, 10350); // +3.5%
  assert.equal(inv.status, 'pending');
  assert.equal(inv.payment_plan, 'per_service');
});
