// Tests for passwordless auth token lifecycle (utils/client-auth.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');
const {
  createLoginToken, consumeLoginToken, createSession, validateSession,
  destroySession, purgeExpiredTokens,
} = require('../utils/client-auth');

// A client to attach tokens to.
function makeClient(db) {
  const p = addProperty(db, 'Tok');
  const e = addEstimate(db, { propertyId: p, name: 'Tok', plan: 'monthly' });
  db.prepare('UPDATE estimates SET email = ? WHERE id = ?').run('tok@x.com', e);
  db.prepare("INSERT INTO clients (email, name) VALUES ('tok@x.com', 'Tok')").run();
  return db.prepare("SELECT id FROM clients WHERE email = 'tok@x.com'").get().id;
}

test('login token works exactly once', () => {
  const db = makeDb();
  const cid = makeClient(db);
  const raw = createLoginToken(db, cid);
  assert.equal(consumeLoginToken(db, raw), cid, 'first use returns client id');
  assert.equal(consumeLoginToken(db, raw), null, 'second use is rejected (single-use)');
});

test('unknown / empty login tokens are rejected', () => {
  const db = makeDb();
  makeClient(db);
  assert.equal(consumeLoginToken(db, 'not-a-real-token'), null);
  assert.equal(consumeLoginToken(db, ''), null);
  assert.equal(consumeLoginToken(db, null), null);
});

test('expired login token is rejected', () => {
  const db = makeDb();
  const cid = makeClient(db);
  const raw = createLoginToken(db, cid);
  // Force expiry into the past.
  db.prepare("UPDATE client_auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'login'").run();
  assert.equal(consumeLoginToken(db, raw), null);
});

test('session validates, then is destroyed on logout', () => {
  const db = makeDb();
  const cid = makeClient(db);
  const session = createSession(db, cid);
  assert.equal(validateSession(db, session), cid);
  destroySession(db, session);
  assert.equal(validateSession(db, session), null, 'destroyed session no longer validates');
});

test('expired session is rejected', () => {
  const db = makeDb();
  const cid = makeClient(db);
  const session = createSession(db, cid);
  db.prepare("UPDATE client_auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'session'").run();
  assert.equal(validateSession(db, session), null);
});

test('a login token cannot be used as a session (and vice versa)', () => {
  const db = makeDb();
  const cid = makeClient(db);
  const login = createLoginToken(db, cid);
  const session = createSession(db, cid);
  assert.equal(validateSession(db, login), null, 'login token is not a session');
  assert.equal(consumeLoginToken(db, session), null, 'session token is not a login token');
});

test('purgeExpiredTokens removes expired and used tokens', () => {
  const db = makeDb();
  const cid = makeClient(db);
  const used = createLoginToken(db, cid);
  consumeLoginToken(db, used);                 // now used
  const expired = createLoginToken(db, cid);
  db.prepare("UPDATE client_auth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash != (SELECT token_hash FROM client_auth_tokens WHERE used_at IS NOT NULL)").run();
  const live = createSession(db, cid);         // a valid session should survive
  const removed = purgeExpiredTokens(db);
  assert.ok(removed >= 2, 'removed used + expired');
  assert.equal(validateSession(db, live), cid, 'valid session untouched');
});
