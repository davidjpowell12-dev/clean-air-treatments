// Which invoices get the seasonal breakdown, and which lead with a
// description instead.
//
// A combined invoice for Beth McLane ($952 of completed work, consolidated
// from 9 invoices) sat on a monthly estimate whose season is $592. The page
// printed a service list totalling $592 and then asked for $985.32 — the
// breakdown contradicted the amount, and the three per-service visits it
// covered weren't in the list at all (different estimate).
//
// Mirrors the rule in routes/payments.js GET /public/receipt/:token.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const CARD_FEE_RATE = 0.035;

function isCustomCharge({ amount, plan, lineItems }) {
  const exFee = amount / (1 + CARD_FEE_RATE);
  const near = (a, b) => Math.abs(a - b) < 0.02;
  const matchesAmount = (v) => near(amount, v) || near(exFee, v);
  const seasonTotal = lineItems.reduce((s, v) => s + v, 0);
  const explains =
    plan === 'monthly' ||
    (lineItems.length > 0 && matchesAmount(seasonTotal)) ||
    lineItems.some(v => matchesAmount(v));
  return lineItems.length > 0 && !explains;
}

test("Beth's combined invoice is a custom charge — no contradicting breakdown", () => {
  // Monthly estimate: $592 season. Combined invoice: $952 + card fee.
  assert.equal(isCustomCharge({ amount: 985.32, plan: 'full', lineItems: [592] }), true);
  // Same by check, no fee.
  assert.equal(isCustomCharge({ amount: 952.00, plan: 'full', lineItems: [592] }), true);
});

test('a monthly installment still shows the seasonal plan', () => {
  assert.equal(isCustomCharge({ amount: 102.12, plan: 'monthly', lineItems: [592] }), false);
});

test('a pay-in-full invoice still shows the breakdown, with or without the card fee', () => {
  assert.equal(isCustomCharge({ amount: 592.00, plan: 'full', lineItems: [400, 192] }), false);
  assert.equal(isCustomCharge({ amount: 612.72, plan: 'full', lineItems: [400, 192] }), false, '592 + 3.5%');
});

test('a per-service invoice matching one service still shows the breakdown', () => {
  // $120 mosquito application billed at $124.20 with the card fee.
  assert.equal(isCustomCharge({ amount: 124.20, plan: 'per_service', lineItems: [120, 360, 80] }), false);
  assert.equal(isCustomCharge({ amount: 120.00, plan: 'per_service', lineItems: [120, 360, 80] }), false);
});

test('a one-off charge matching nothing leads with its description', () => {
  assert.equal(isCustomCharge({ amount: 500.00, plan: 'full', lineItems: [592] }), true);
  assert.equal(isCustomCharge({ amount: 950.00, plan: 'per_service', lineItems: [120, 360] }), true);
});

test('an estimate with no line items is never marked custom — there is nothing to contradict', () => {
  assert.equal(isCustomCharge({ amount: 985.32, plan: 'full', lineItems: [] }), false);
});

test('rounding does not flip a legitimate match', () => {
  // 98.67 x 1.035 = 102.123 -> billed 102.12
  assert.equal(isCustomCharge({ amount: 102.12, plan: 'per_service', lineItems: [98.67] }), false);
});
