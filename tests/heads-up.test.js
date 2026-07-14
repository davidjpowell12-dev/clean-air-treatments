// Tests for the evening heads-up job (utils/heads-up.js): auto-email +
// SMS-draft generation for tomorrow's visits, idempotency, and channel
// independence (email vs SMS opt-in).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { runEveningHeadsUps, generateHeadsUpDrafts } = require('../utils/heads-up');

const DATE = '2026-07-01';

function addProp(db, { name, email = null, phone = '6165551234', smsOptIn = 1, headsUpNote = null }) {
  return db.prepare(`INSERT INTO properties (customer_name, address, city, email, phone, sms_opted_in, heads_up_note)
                     VALUES (?, '1 Test St', 'Grand Rapids', ?, ?, ?, ?)`)
    .run(name, email, phone, smsOptIn, headsUpNote).lastInsertRowid;
}
function addVisit(db, propId, { date = DATE, service = 'Fert & Weed Control', status = 'scheduled' } = {}) {
  return db.prepare(`INSERT INTO schedules (property_id, scheduled_date, service_type, status)
                     VALUES (?, ?, ?, ?)`).run(propId, date, service, status).lastInsertRowid;
}
// Collects sent emails instead of hitting SendGrid.
function fakeSender(sent) { return async (msg) => { sent.push(msg); }; }

test('emails every visit with an address, stamps idempotency, includes the heads-up note', async () => {
  const db = makeDb();
  const p = addProp(db, { name: 'Pets Family', email: 'pets@x.com', headsUpNote: 'Please have pets and kids inside before we arrive' });
  const s = addVisit(db, p);
  const sent = [];

  const r = await runEveningHeadsUps(db, { date: DATE, sendEmail: fakeSender(sent) });
  assert.equal(r.emailed, 1);
  assert.equal(sent[0].to, 'pets@x.com');
  assert.ok(sent[0].bodyText.includes('Please have pets and kids inside'), 'custom note included');
  assert.ok(!sent[0].bodyText.includes('Reply STOP'), 'SMS opt-out omitted from email');
  assert.ok(db.prepare('SELECT heads_up_emailed_at FROM schedules WHERE id = ?').get(s).heads_up_emailed_at, 'stamped');
  assert.equal(r.sms_drafts_created, 1, 'SMS draft also generated');
});

test('second run is a no-op (no duplicate emails or drafts)', async () => {
  const db = makeDb();
  addVisit(db, addProp(db, { name: 'Once', email: 'once@x.com' }));
  const sent = [];
  await runEveningHeadsUps(db, { date: DATE, sendEmail: fakeSender(sent) });
  const r2 = await runEveningHeadsUps(db, { date: DATE, sendEmail: fakeSender(sent) });
  assert.equal(sent.length, 1, 'only the first run emailed');
  assert.equal(r2.emailed, 0);
  assert.equal(r2.email_already_sent, 1);
  assert.equal(r2.sms_drafts_created, 0);
  assert.equal(r2.sms_drafts_existing, 1);
});

test('channels are independent: no email → draft still made; SMS opt-out → email still sent', async () => {
  const db = makeDb();
  addVisit(db, addProp(db, { name: 'No Email', email: null }));                       // draft only
  addVisit(db, addProp(db, { name: 'No SMS', email: 'nosms@x.com', smsOptIn: 0 }));   // email only
  const sent = [];

  const r = await runEveningHeadsUps(db, { date: DATE, sendEmail: fakeSender(sent) });
  assert.equal(r.emailed, 1);
  assert.equal(sent[0].to, 'nosms@x.com');
  assert.equal(r.email_no_address, 1);
  assert.equal(r.sms_drafts_created, 1, 'draft for the no-email customer');
  const draft = db.prepare("SELECT * FROM message_drafts WHERE type = 'heads_up'").get();
  assert.equal(db.prepare('SELECT customer_name FROM properties WHERE id = ?').get(draft.property_id).customer_name, 'No Email');
});

test('email channel off (sendEmail null) still generates drafts', async () => {
  const db = makeDb();
  addVisit(db, addProp(db, { name: 'DraftOnly', email: 'has@x.com' }));
  const r = await runEveningHeadsUps(db, { date: DATE, sendEmail: null });
  assert.equal(r.email_channel, 'off');
  assert.equal(r.emailed, 0);
  assert.equal(r.sms_drafts_created, 1);
});

test('completed/cancelled visits and other dates are excluded', async () => {
  const db = makeDb();
  const p = addProp(db, { name: 'Done', email: 'done@x.com' });
  addVisit(db, p, { status: 'completed' });
  addVisit(db, p, { date: '2026-08-15' }); // different date
  const sent = [];
  const r = await runEveningHeadsUps(db, { date: DATE, sendEmail: fakeSender(sent) });
  assert.equal(r.visits, 0);
  assert.equal(sent.length, 0);
});

test('a failed email does not stamp the visit (retried next run)', async () => {
  const db = makeDb();
  const s = addVisit(db, addProp(db, { name: 'Flaky', email: 'flaky@x.com' }));
  const r1 = await runEveningHeadsUps(db, { date: DATE, sendEmail: async () => { throw new Error('sendgrid down'); } });
  assert.equal(r1.email_failed, 1);
  assert.equal(db.prepare('SELECT heads_up_emailed_at FROM schedules WHERE id = ?').get(s).heads_up_emailed_at, null);
  const sent = [];
  const r2 = await runEveningHeadsUps(db, { date: DATE, sendEmail: fakeSender(sent) });
  assert.equal(r2.emailed, 1, 'succeeds on retry');
});
