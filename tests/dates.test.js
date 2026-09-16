// Invoice due dates must be stored as YYYY-MM-DD.
//
// Reproduces the reported bug: a one-off invoice with its due date typed as
// '9/16/2026' showed "Invalid Date" and vanished from the Invoicing views,
// which compare due_date to today as plain text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDate } = require('../utils/dates');

test('the format that caused the bug is converted, not stored as-is', () => {
  assert.equal(normalizeDate('9/16/2026'), '2026-09-16');
});

test('why it mattered: a raw US date is never "upcoming" to a text comparison', () => {
  const in30 = '2026-10-16';
  assert.equal('9/16/2026' <= in30, false, 'the unnormalized value dropped out of Upcoming');
  assert.equal(normalizeDate('9/16/2026') <= in30, true, 'the normalized value is found');
});

test('accepted formats', () => {
  assert.equal(normalizeDate('2026-09-16'), '2026-09-16');
  assert.equal(normalizeDate('2026-9-6'), '2026-09-06', 'pads single digits');
  assert.equal(normalizeDate('09/06/2026'), '2026-09-06');
  assert.equal(normalizeDate('9/6/26'), '2026-09-06', 'two-digit year');
  assert.equal(normalizeDate('9-16-2026'), '2026-09-16');
  assert.equal(normalizeDate('  9/16/2026  '), '2026-09-16', 'whitespace');
});

test('impossible dates are refused rather than rolled over', () => {
  assert.equal(normalizeDate('2/30/2026'), null, 'no Feb 30 → Mar 2');
  assert.equal(normalizeDate('13/1/2026'), null);
  assert.equal(normalizeDate('2026-02-29'), null, '2026 is not a leap year');
  assert.equal(normalizeDate('2028-02-29'), '2028-02-29', '2028 is');
});

test('things that are not dates return null', () => {
  for (const v of ['today', 'Sept 16', '16.9.2026', '20260916', '', '   ', null, undefined]) {
    assert.equal(normalizeDate(v), null, `rejects ${JSON.stringify(v)}`);
  }
});
