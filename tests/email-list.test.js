// Tests for the mailing-list export (utils/email-list.js).
// The risk here isn't a crash — it's quietly exporting the same person three
// times, tagging a paying customer as a cold prospect, or shipping a malformed
// address that hurts sender reputation on the first send.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const { buildEmailList, splitName } = require('../utils/email-list');

const addProp = (db, name, email, extra = {}) =>
  db.prepare('INSERT INTO properties (customer_name, address, email, city, zip, phone, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, extra.address || '1 Main St', email, extra.city || 'Grand Rapids',
      extra.zip || '49503', extra.phone || null, extra.is_active === undefined ? 1 : extra.is_active);

const addEst = (db, name, email, status) =>
  db.prepare('INSERT INTO estimates (customer_name, address, email, status, total_price) VALUES (?, ?, ?, ?, 0)')
    .run(name, '1 Main St', email, status);

const find = (rows, email) => rows.find(r => r.email === email);

test('one row per address, even when the same person is in all three tables', () => {
  const db = makeDb();
  addProp(db, 'Carol Rich', 'carol@example.com');
  addEst(db, 'Carol Rich', 'carol@example.com', 'accepted');
  db.prepare("INSERT INTO clients (email, name) VALUES ('carol@example.com', 'Carol Rich')").run();

  const { rows, counts } = buildEmailList(db);
  assert.equal(rows.length, 1, 'no duplicate rows');
  assert.equal(counts.total, 1);
  assert.equal(rows[0].segment, 'customer');
});

test('the same address in different cases/whitespace is one person', () => {
  const db = makeDb();
  addProp(db, 'Dave P', '  Dave@Example.COM ');
  addEst(db, 'Dave P', 'dave@example.com', 'sent');
  const { rows } = buildEmailList(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'dave@example.com', 'normalized to lowercase');
});

test('a customer who also has an old unconverted estimate stays a customer', () => {
  const db = makeDb();
  addProp(db, 'Lisa Royce', 'lisa@example.com');
  addEst(db, 'Lisa Royce', 'lisa@example.com', 'declined'); // an old quote
  const { rows } = buildEmailList(db);
  assert.equal(find(rows, 'lisa@example.com').segment, 'customer', 'strongest relationship wins');
});

test('segments are assigned from the real relationship', () => {
  const db = makeDb();
  addProp(db, 'Active Al', 'al@example.com', { is_active: 1 });
  addProp(db, 'Gone Gary', 'gary@example.com', { is_active: 0 });
  addEst(db, 'Quoted Quinn', 'quinn@example.com', 'sent');
  addEst(db, 'Signed Sam', 'sam@example.com', 'accepted');

  const { rows, counts } = buildEmailList(db);
  assert.equal(find(rows, 'al@example.com').segment, 'customer');
  assert.equal(find(rows, 'gary@example.com').segment, 'past_customer');
  assert.equal(find(rows, 'quinn@example.com').segment, 'prospect');
  assert.equal(find(rows, 'sam@example.com').segment, 'customer', 'accepted estimate = customer');
  assert.deepEqual(counts, { total: 4, customer: 2, past_customer: 1, prospect: 1 });
});

test('unusable addresses are dropped, not exported', () => {
  const db = makeDb();
  addProp(db, 'No Email', null);
  addProp(db, 'Blank', '   ');
  addProp(db, 'Malformed', 'not-an-email');
  addProp(db, 'Real Person', 'real@example.com');

  const { rows } = buildEmailList(db);
  assert.equal(rows.length, 1, 'only the deliverable address survives');
  assert.equal(rows[0].email, 'real@example.com');
});

test('details missing from the winning row are filled in from the others', () => {
  const db = makeDb();
  // The client row wins on segment but carries no city/zip.
  db.prepare("INSERT INTO clients (email, name) VALUES ('mix@example.com', 'Mix Person')").run();
  addEst(db, 'Mix Person', 'mix@example.com', 'sent');
  db.prepare("UPDATE estimates SET city = 'Ada', zip = '49301' WHERE email = 'mix@example.com'").run();

  const r = find(buildEmailList(db).rows, 'mix@example.com');
  assert.equal(r.segment, 'customer');
  assert.equal(r.city, 'Ada', 'city recovered from the estimate');
  assert.equal(r.zip, '49301');
});

test('customers sort first so a partial import still gets the best addresses', () => {
  const db = makeDb();
  addEst(db, 'Zed Prospect', 'zed@example.com', 'sent');
  addProp(db, 'Amy Customer', 'amy@example.com');
  const { rows } = buildEmailList(db);
  assert.equal(rows[0].segment, 'customer');
});

test('names split for personalization without mangling joint names', () => {
  assert.deepEqual(splitName('Carol Rich'), { first: 'Carol', last: 'Rich' });
  assert.deepEqual(splitName('Mary Jo Van Dyke'), { first: 'Mary Jo Van', last: 'Dyke' });
  assert.deepEqual(splitName('Cher'), { first: 'Cher', last: '' });
  // "Hi &" would be worse than "Hi Bob & Sue Smith" — leave joint names whole.
  assert.deepEqual(splitName('Bob & Sue Smith'), { first: 'Bob & Sue Smith', last: '' });
  assert.deepEqual(splitName('Smith, John'), { first: 'Smith, John', last: '' });
  assert.deepEqual(splitName(null), { first: '', last: '' });
});

test('an empty database exports an empty list, not an error', () => {
  const { rows, counts } = buildEmailList(makeDb());
  assert.deepEqual(rows, []);
  assert.equal(counts.total, 0);
});
