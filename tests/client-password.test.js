// Tests for client portal password auth (utils/client-password.js).
// This is the gate on customers' billing data, so the access rules — only
// existing customers, one registration per email, no silent overwrite — are
// what these lock down.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb } = require('./helpers');
const {
  registerClientPassword, verifyClientPassword, clearClientPassword, MIN_PASSWORD_LENGTH
} = require('../utils/client-password');

function addClient(db, email, name = 'Test Client') {
  db.prepare('INSERT INTO clients (email, name) VALUES (?, ?)').run(email, name);
  return db.prepare('SELECT id FROM clients WHERE email = ?').get(email).id;
}

test('an existing customer can register and then sign in', () => {
  const db = makeDb();
  const id = addClient(db, 'carol@example.com', 'Carol Rich');

  const reg = registerClientPassword(db, 'carol@example.com', 'lawncare2026');
  assert.equal(reg.ok, true);
  assert.equal(reg.clientId, id);

  const login = verifyClientPassword(db, 'carol@example.com', 'lawncare2026');
  assert.equal(login.ok, true);
  assert.equal(login.clientId, id);
});

test('the password is hashed, never stored in the clear', () => {
  const db = makeDb();
  addClient(db, 'hash@example.com');
  registerClientPassword(db, 'hash@example.com', 'lawncare2026');
  const row = db.prepare("SELECT password_hash, password_set_at FROM clients WHERE email = 'hash@example.com'").get();
  assert.ok(row.password_hash && row.password_hash.length > 20);
  assert.ok(!row.password_hash.includes('lawncare2026'));
  assert.ok(row.password_set_at, 'records when it was set');
});

test('email is matched case/whitespace-insensitively, like the rest of the app', () => {
  const db = makeDb();
  addClient(db, 'mixed@example.com');
  assert.equal(registerClientPassword(db, '  Mixed@Example.COM ', 'lawncare2026').ok, true);
  assert.equal(verifyClientPassword(db, 'MIXED@example.com', 'lawncare2026').ok, true);
});

test('someone who is not a customer cannot register', () => {
  const db = makeDb();
  addClient(db, 'real@example.com');
  const r = registerClientPassword(db, 'stranger@example.com', 'lawncare2026');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'not_a_customer');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM clients').get().c, 1, 'no account is created');
});

test('a second registration cannot overwrite an existing password', () => {
  const db = makeDb();
  addClient(db, 'taken@example.com');
  registerClientPassword(db, 'taken@example.com', 'original-password');

  const second = registerClientPassword(db, 'taken@example.com', 'attacker-password');
  assert.equal(second.ok, false);
  assert.equal(second.code, 'already_registered');

  // The original password must still be the one that works.
  assert.equal(verifyClientPassword(db, 'taken@example.com', 'original-password').ok, true);
  assert.equal(verifyClientPassword(db, 'taken@example.com', 'attacker-password').ok, false);
});

test('short passwords are rejected', () => {
  const db = makeDb();
  addClient(db, 'short@example.com');
  const r = registerClientPassword(db, 'short@example.com', 'a'.repeat(MIN_PASSWORD_LENGTH - 1));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'weak_password');
});

test('wrong password and unknown email give the same generic message', () => {
  const db = makeDb();
  addClient(db, 'known@example.com');
  registerClientPassword(db, 'known@example.com', 'lawncare2026');

  const wrongPass = verifyClientPassword(db, 'known@example.com', 'not-it');
  const unknown = verifyClientPassword(db, 'nobody@example.com', 'lawncare2026');
  assert.equal(wrongPass.ok, false);
  assert.equal(unknown.ok, false);
  assert.equal(wrongPass.reason, unknown.reason, 'no account enumeration on sign-in');
});

test('a customer who never registered cannot sign in', () => {
  const db = makeDb();
  addClient(db, 'noaccount@example.com');
  assert.equal(verifyClientPassword(db, 'noaccount@example.com', 'anything').ok, false);
});

test('owner reset clears the password and allows re-registering', () => {
  const db = makeDb();
  const id = addClient(db, 'forgot@example.com');
  registerClientPassword(db, 'forgot@example.com', 'old-password');

  assert.equal(clearClientPassword(db, id), true);
  assert.equal(verifyClientPassword(db, 'forgot@example.com', 'old-password').ok, false, 'old password stops working');

  const again = registerClientPassword(db, 'forgot@example.com', 'brand-new-password');
  assert.equal(again.ok, true, 'they can register again after a reset');
  assert.equal(verifyClientPassword(db, 'forgot@example.com', 'brand-new-password').ok, true);
});

test('empty/garbage input is rejected without throwing', () => {
  const db = makeDb();
  addClient(db, 'x@example.com');
  assert.equal(registerClientPassword(db, '', 'lawncare2026').ok, false);
  assert.equal(registerClientPassword(db, 'not-an-email', 'lawncare2026').ok, false);
  assert.equal(registerClientPassword(db, 'x@example.com', '').ok, false);
  assert.equal(verifyClientPassword(db, null, null).ok, false);
});
