// Password login for the client portal.
//
// Magic links require the app to send email, which isn't available here (no
// SendGrid). Instead the owner emails a portal link from his own inbox and
// customers register themselves using the email address already on file.
//
// The "email must already exist in clients" rule is the real access gate:
// only people the business already has as customers can create a login.
const bcrypt = require('bcryptjs');
const { normalizeEmail } = require('./clients');

const MIN_PASSWORD_LENGTH = 8;

/**
 * Register a portal password for an existing customer.
 * @returns {{ok:true, clientId:number} | {ok:false, code:string, reason:string}}
 */
function registerClientPassword(db, emailInput, password) {
  const email = normalizeEmail(emailInput);
  if (!email) return { ok: false, code: 'bad_email', reason: 'Enter a valid email address.' };
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return { ok: false, code: 'weak_password', reason: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const client = db.prepare('SELECT id, password_hash FROM clients WHERE email = ?').get(email);
  // Deliberately specific: this is a closed portal for existing customers, so
  // telling someone their address isn't on file is the helpful answer (and
  // reveals nothing they couldn't learn by asking). Not a public signup form.
  if (!client) {
    return { ok: false, code: 'not_a_customer', reason: "We don't have that email on file. Use the address we have for you, or reply to the email we sent." };
  }
  // First registration wins. A second attempt means either the customer
  // forgot, or someone else already claimed it — both need the owner, and
  // silently overwriting would be an account takeover.
  if (client.password_hash) {
    return { ok: false, code: 'already_registered', reason: 'An account already exists for that email. Sign in instead, or contact us to reset it.' };
  }

  db.prepare(
    'UPDATE clients SET password_hash = ?, password_set_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(bcrypt.hashSync(String(password), 10), client.id);

  return { ok: true, clientId: client.id };
}

/**
 * Verify an email + password pair.
 * @returns {{ok:true, clientId:number} | {ok:false, code:string, reason:string}}
 */
function verifyClientPassword(db, emailInput, password) {
  const email = normalizeEmail(emailInput);
  const generic = { ok: false, code: 'bad_credentials', reason: 'That email and password don\'t match.' };
  if (!email || !password) return generic;

  const client = db.prepare('SELECT id, password_hash FROM clients WHERE email = ?').get(email);
  // Same message whether the email is unknown or the password is wrong — on
  // the sign-in path there's no reason to help someone enumerate accounts.
  if (!client || !client.password_hash) return generic;
  if (!bcrypt.compareSync(String(password), client.password_hash)) return generic;

  return { ok: true, clientId: client.id };
}

/** Owner-initiated reset: clears the password so the customer can register
 *  again. Without email there's no self-service reset link, so this is how a
 *  forgotten password gets fixed. */
function clearClientPassword(db, clientId) {
  const r = db.prepare(
    'UPDATE clients SET password_hash = NULL, password_set_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(clientId);
  return r.changes > 0;
}

module.exports = { registerClientPassword, verifyClientPassword, clearClientPassword, MIN_PASSWORD_LENGTH };
