// Tests for buildFollowUpDigest — the evening push that stops follow-ups from
// quietly aging out of mind. Date bucketing is the whole point here, so the
// boundaries (overdue vs today vs tomorrow) are what these lock down.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty } = require('./helpers');
const { buildFollowUpDigest } = require('../routes/follow-ups');

// Fixed reference date so these never depend on when they run.
const TODAY = '2026-08-11';
const YESTERDAY = '2026-08-10';
const TOMORROW = '2026-08-12';
const NEXT_WEEK = '2026-08-25';

function addFollowUp(db, { title, due = null, status = 'open', propId = null, snoozedUntil = null, kind = null }) {
  return db.prepare(`
    INSERT INTO follow_ups (property_id, title, bucket, waiting_on, status, due_date, kind, snoozed_until)
    VALUES (?, ?, 'today', 'me', ?, ?, ?, ?)
  `).run(propId, title, status, due, kind, snoozedUntil).lastInsertRowid;
}

test('buckets items into overdue / today / tomorrow and ignores later ones', () => {
  const db = makeDb();
  addFollowUp(db, { title: 'Call back Marsh', due: YESTERDAY });
  addFollowUp(db, { title: 'Quote the Elm St job', due: YESTERDAY });
  addFollowUp(db, { title: 'Order fertilizer', due: TODAY });
  addFollowUp(db, { title: 'Confirm aeration date', due: TOMORROW });
  addFollowUp(db, { title: 'Winter planning', due: NEXT_WEEK });

  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.equal(d.overdue, 2);
  assert.equal(d.due_today, 1);
  assert.equal(d.due_tomorrow, 1);
  assert.equal(d.total, 4, 'next week is not counted as needing attention yet');
  assert.match(d.text, /OVERDUE \(2\)/);
  assert.match(d.text, /DUE TODAY \(1\)/);
  assert.match(d.text, /TOMORROW \(1\)/);
  assert.ok(!d.text.includes('Winter planning'), 'far-future items stay out of the digest');
});

test('stays silent when nothing is due, even with an unsorted backlog', () => {
  const db = makeDb();
  addFollowUp(db, { title: 'Someday: rebrand truck' });        // undated
  addFollowUp(db, { title: 'Later thing', due: NEXT_WEEK });    // not due yet

  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.equal(d.total, 0);
  assert.equal(d.text, null, 'no interruption when nothing is actually due');
  assert.equal(d.unsorted, 1, 'but the backlog is still reported for context');
});

test('reports the unsorted count as context when something IS due', () => {
  const db = makeDb();
  addFollowUp(db, { title: 'Overdue thing', due: YESTERDAY });
  addFollowUp(db, { title: 'No date 1' });
  addFollowUp(db, { title: 'No date 2' });

  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.equal(d.unsorted, 2);
  assert.match(d.text, /2 unsorted follow-ups still need a date/);
});

test('excludes completed and snoozed items', () => {
  const db = makeDb();
  addFollowUp(db, { title: 'Already handled', due: YESTERDAY, status: 'done' });
  addFollowUp(db, { title: 'Snoozed away', due: YESTERDAY, snoozedUntil: '2099-01-01T00:00:00Z' });
  addFollowUp(db, { title: 'Genuinely open', due: YESTERDAY });

  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.equal(d.overdue, 1, 'only the open, un-snoozed item counts');
  assert.match(d.text, /Genuinely open/);
  assert.ok(!d.text.includes('Already handled'));
  assert.ok(!d.text.includes('Snoozed away'));
});

test('includes the customer name so an item is actionable at a glance', () => {
  const db = makeDb();
  const propId = addProperty(db, 'Curt Meyer');
  addFollowUp(db, { title: 'Wants mosquito quote', due: TODAY, propId });

  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.match(d.text, /Curt Meyer: Wants mosquito quote/);
});

test('caps a long overdue list rather than dumping everything', () => {
  const db = makeDb();
  for (let i = 1; i <= 14; i++) addFollowUp(db, { title: 'Old item ' + i, due: YESTERDAY });

  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.equal(d.overdue, 14, 'count is still complete');
  assert.match(d.text, /and 4 more/, 'body is truncated to stay readable');
});

test('an empty board produces nothing', () => {
  const db = makeDb();
  const d = buildFollowUpDigest(db, { today: TODAY });
  assert.equal(d.total, 0);
  assert.equal(d.unsorted, 0);
  assert.equal(d.text, null);
});
