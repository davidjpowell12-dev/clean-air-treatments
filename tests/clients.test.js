// Tests for client identity + the security scope boundary (utils/clients.js).
// The cross-client isolation test is the most important one in the suite:
// it guards against one customer ever seeing another's records in the portal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');
const {
  normalizeEmail, findOrCreateClientByEmail, backfillClients, getClientScope, clientOwnsInvoice,
} = require('../utils/clients');

function addInvoice(db, estimateId, number = 'I-' + Math.floor(Math.random() * 1e9)) {
  db.prepare(
    "INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan) VALUES (?, ?, 1000, 'pending', 'monthly')"
  ).run(number, estimateId);
  return db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(number).id;
}

test('normalizeEmail lowercases, trims, and rejects junk', () => {
  assert.equal(normalizeEmail('  Bob@Example.COM '), 'bob@example.com');
  assert.equal(normalizeEmail('no-at-sign'), null);
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail(null), null);
});

test('backfill: two estimates with the same email collapse to ONE client', () => {
  const db = makeDb();
  const p1 = addProperty(db, 'Deb', '1 A St');
  const p2 = addProperty(db, 'Deb', '2 B St');
  const e1 = addEstimate(db, { propertyId: p1, name: 'Deb', plan: 'monthly' });
  const e2 = addEstimate(db, { propertyId: p2, name: 'Deb', plan: 'monthly' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('Deb@Comcast.net', e1);
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('deb@comcast.net ', e2); // case/space variant

  const r = backfillClients(db);
  assert.equal(r.clientsCreated, 1, 'one client for one email');
  assert.equal(r.estimatesLinked, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);

  // Both estimates point at the same client → multi-property handled.
  const cid1 = db.prepare('SELECT client_id FROM estimates WHERE id = ?').get(e1).client_id;
  const cid2 = db.prepare('SELECT client_id FROM estimates WHERE id = ?').get(e2).client_id;
  assert.equal(cid1, cid2);

  const scope = getClientScope(db, cid1);
  assert.equal(scope.estimateIds.length, 2);
  assert.equal(scope.propertyIds.length, 2, 'owns both properties');
});

test('backfill: estimate with no email is left unlinked (phone/staff-link customer)', () => {
  const db = makeDb();
  const p = addProperty(db, 'NoEmail');
  const e = addEstimate(db, { propertyId: p, name: 'NoEmail', plan: 'full' });
  db.prepare('UPDATE estimates SET email = NULL WHERE id = ?').run(e);

  const r = backfillClients(db);
  assert.equal(r.skippedNoEmail, 1);
  assert.equal(db.prepare('SELECT client_id FROM estimates WHERE id = ?').get(e).client_id, null);
});

test('backfill is idempotent — running twice creates no duplicates', () => {
  const db = makeDb();
  const p = addProperty(db, 'X');
  const e = addEstimate(db, { propertyId: p, name: 'X', plan: 'full' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('x@x.com', e);
  backfillClients(db);
  const second = backfillClients(db);
  assert.equal(second.totalScanned, 0, 'nothing left to link on second run');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1);
});

test('SECURITY: getClientScope never leaks another client\'s records', () => {
  const db = makeDb();
  // Client A
  const pa = addProperty(db, 'Alice');
  const ea = addEstimate(db, { propertyId: pa, name: 'Alice', plan: 'monthly' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('alice@x.com', ea);
  // Client B
  const pb = addProperty(db, 'Bob');
  const eb = addEstimate(db, { propertyId: pb, name: 'Bob', plan: 'monthly' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('bob@x.com', eb);

  backfillClients(db);
  const aId = db.prepare("SELECT id FROM clients WHERE email = 'alice@x.com'").get().id;
  const bId = db.prepare("SELECT id FROM clients WHERE email = 'bob@x.com'").get().id;

  const ia = addInvoice(db, ea);
  const ib = addInvoice(db, eb);

  const scopeA = getClientScope(db, aId);
  assert.deepEqual(scopeA.estimateIds, [ea], 'A sees only their estimate');
  assert.deepEqual(scopeA.propertyIds, [pa], 'A sees only their property');
  assert.deepEqual(scopeA.invoiceIds, [ia], 'A sees only their invoice');
  assert.ok(!scopeA.invoiceIds.includes(ib), 'A must NOT see B\'s invoice');

  // Ownership checks gate payment actions.
  assert.equal(clientOwnsInvoice(db, aId, ia), true);
  assert.equal(clientOwnsInvoice(db, aId, ib), false, 'A cannot act on B\'s invoice');
});

test('findOrCreateClientByEmail is stable and returns null on bad email', () => {
  const db = makeDb();
  const c1 = findOrCreateClientByEmail(db, 'Sam@x.com');
  const c2 = findOrCreateClientByEmail(db, 'sam@x.com');
  assert.equal(c1.id, c2.id);
  assert.equal(findOrCreateClientByEmail(db, 'garbage'), null);
});
