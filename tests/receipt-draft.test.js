// Tests for createReceiptDraft (routes/messaging.js) — the receipt SMS draft
// the auto-charge cron queues after it charges a card. Texts go out from the
// owner's own phone, so this draft is the delivery path that actually reaches
// customers; a silent failure here means a charged customer gets no receipt.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');
const { createReceiptDraft } = require('../routes/messaging');

const BASE = 'https://example.test';

function setup(db, { phone = '6165551234', smsOptIn = 1, token = 'tok-abc' } = {}) {
  const propId = addProperty(db, 'Receipt Customer');
  db.prepare('UPDATE properties SET phone = ?, sms_opted_in = ? WHERE id = ?').run(phone, smsOptIn, propId);
  const estId = addEstimate(db, { propertyId: propId, name: 'Receipt Customer' });
  db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, paid_at, token)
              VALUES ('CA-R-1', ?, 12950, 'paid', 'monthly', '2026-05-01T12:00:00Z', ?)`).run(estId, token);
  const invId = db.prepare("SELECT id FROM invoices WHERE invoice_number = 'CA-R-1'").get().id;
  return { propId, estId, invId };
}

const drafts = (db) => db.prepare("SELECT * FROM message_drafts WHERE type = 'receipt'").all();

test('queues a receipt draft with the amount, business name, and receipt link', () => {
  const db = makeDb();
  const { invId, propId } = setup(db);

  const r = createReceiptDraft(db, invId, { baseUrl: BASE });
  assert.equal(r.ok, true);
  assert.equal(r.already_existed, false);

  const all = drafts(db);
  assert.equal(all.length, 1);
  const d = all[0];
  assert.equal(d.status, 'draft', 'stays a draft — never auto-sends');
  assert.equal(d.to_phone, '6165551234');
  assert.equal(d.property_id, propId);
  assert.match(d.composed_text, /\$129\.50/, 'includes the amount paid');
  assert.match(d.composed_text, /Receipt/i);
  assert.equal(d.composed_text.includes(BASE + '/receipt/tok-abc'), true, 'links to the receipt page');
  assert.match(d.composed_text, /Reply STOP/i, 'keeps the SMS opt-out line');
});

test('idempotent — a second call returns the existing draft, never a duplicate', () => {
  const db = makeDb();
  const { invId } = setup(db);

  const first = createReceiptDraft(db, invId, { baseUrl: BASE });
  const second = createReceiptDraft(db, invId, { baseUrl: BASE });

  assert.equal(second.ok, true);
  assert.equal(second.already_existed, true);
  assert.equal(second.draft_id, first.draft_id);
  assert.equal(drafts(db).length, 1, 'still exactly one draft for this invoice');
});

test('skips (without throwing) when there is no phone on file', () => {
  const db = makeDb();
  const { invId } = setup(db, { phone: null });
  const r = createReceiptDraft(db, invId, { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /phone/i);
  assert.equal(drafts(db).length, 0);
});

test('respects SMS opt-out', () => {
  const db = makeDb();
  const { invId } = setup(db, { smsOptIn: 0 });
  const r = createReceiptDraft(db, invId, { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /opted out/i);
  assert.equal(drafts(db).length, 0);
});

test('skips when the invoice has no receipt token (nothing to link to)', () => {
  const db = makeDb();
  const { invId } = setup(db, { token: null });
  const r = createReceiptDraft(db, invId, { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /token/i);
  assert.equal(drafts(db).length, 0);
});

test('unknown invoice id fails cleanly rather than throwing', () => {
  const db = makeDb();
  const r = createReceiptDraft(db, 999999, { baseUrl: BASE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not found/i);
});

test('a trailing slash on baseUrl does not produce a double slash in the link', () => {
  const db = makeDb();
  const { invId } = setup(db);
  createReceiptDraft(db, invId, { baseUrl: BASE + '/' });
  assert.equal(drafts(db)[0].composed_text.includes(BASE + '/receipt/tok-abc'), true);
});
