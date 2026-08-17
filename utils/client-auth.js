// Passwordless auth for the client portal. Two token kinds, both stored only
// as SHA-256 hashes in client_auth_tokens:
//   - 'login'   : single-use magic-link token, short-lived (15 min)
//   - 'session' : the logged-in session, long-lived (30 days), DB-backed so a
//                 server restart never logs anyone out.
// See docs/client-portal.md.
const crypto = require('crypto');

const LOGIN_TTL_MS = 15 * 60 * 1000;          // 15 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PREVIEW_TTL_MS = 30 * 60 * 1000;        // 30 minutes (staff "view as customer")

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('hex');

function createToken(db, clientId, kind, ttlMs, channel = null) {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(
    'INSERT INTO client_auth_tokens (client_id, token_hash, kind, channel, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(clientId, hashToken(raw), kind, channel, expiresAt);
  return raw;
}

/** Mint a single-use magic-link token. Returns the RAW token to embed in a URL. */
function createLoginToken(db, clientId, channel = 'email') {
  return createToken(db, clientId, 'login', LOGIN_TTL_MS, channel);
}

/**
 * Verify a magic-link token and burn it. Returns the client_id on success,
 * or null if the token is unknown, already used, or expired.
 */
function consumeLoginToken(db, raw) {
  if (!raw) return null;
  const row = db.prepare(
    "SELECT * FROM client_auth_tokens WHERE token_hash = ? AND kind = 'login'"
  ).get(hashToken(raw));
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE client_auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return row.client_id;
}

/** Create a session and return the RAW session token (store in an HttpOnly cookie). */
function createSession(db, clientId) {
  return createToken(db, clientId, 'session', SESSION_TTL_MS);
}

/**
 * Staff "view as customer" session. Deliberately a DIFFERENT kind so it can
 * never be confused with a real customer login: it expires in 30 minutes, the
 * portal renders a preview banner for it, and write actions are refused.
 * Creating one does NOT consume the customer's registration.
 */
function createPreviewSession(db, clientId) {
  return createToken(db, clientId, 'preview', PREVIEW_TTL_MS);
}

/**
 * Look up a session token. Returns { clientId, preview } or null.
 * Accepts both real sessions and staff previews — callers use `preview` to
 * decide what to show and what to refuse.
 */
function readSession(db, raw) {
  if (!raw) return null;
  const row = db.prepare(
    "SELECT * FROM client_auth_tokens WHERE token_hash = ? AND kind IN ('session','preview')"
  ).get(hashToken(raw));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { clientId: row.client_id, preview: row.kind === 'preview' };
}

/** Return the client_id for a valid, unexpired session token, else null. */
function validateSession(db, raw) {
  const s = readSession(db, raw);
  return s ? s.clientId : null;
}

/** Invalidate a session (logout, or exiting a staff preview). */
function destroySession(db, raw) {
  if (!raw) return;
  db.prepare("DELETE FROM client_auth_tokens WHERE token_hash = ? AND kind IN ('session','preview')").run(hashToken(raw));
}

/** Housekeeping: drop expired/used tokens. Safe to call anytime. */
function purgeExpiredTokens(db) {
  return db.prepare(
    "DELETE FROM client_auth_tokens WHERE expires_at < ? OR (kind = 'login' AND used_at IS NOT NULL)"
  ).run(new Date().toISOString()).changes;
}

module.exports = {
  createLoginToken, consumeLoginToken,
  createSession, createPreviewSession, readSession, validateSession, destroySession,
  purgeExpiredTokens,
  LOGIN_TTL_MS, SESSION_TTL_MS, PREVIEW_TTL_MS,
};
