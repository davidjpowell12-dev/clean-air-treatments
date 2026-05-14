// QuickBooks Online OAuth + connection management routes.
//
// Flow:
//   1. GET  /api/quickbooks/connect       → admin clicks, redirects to Intuit
//   2. GET  /api/quickbooks/callback      → Intuit redirects here with code + realmId
//   3. POST /api/quickbooks/disconnect    → wipe stored tokens
//   4. GET  /api/quickbooks/status        → connection state for the Settings UI
//   5. GET  /api/quickbooks/company-info  → smoke test once connected

const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../db/audit');
const qbo = require('../utils/quickbooks');

const router = express.Router();

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QBO_SCOPE = 'com.intuit.quickbooks.accounting';

function getRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/quickbooks/callback`;
}

// Kick off OAuth — admin clicks "Connect to QuickBooks" in Settings.
router.get('/connect', requireAdmin, (req, res) => {
  const clientId = process.env.QBO_CLIENT_ID;
  if (!clientId) return res.status(500).send('QBO_CLIENT_ID not configured on server');

  const state = crypto.randomBytes(16).toString('hex');
  req.session.qbo_oauth_state = state;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: QBO_SCOPE,
    redirect_uri: getRedirectUri(req),
    state
  });
  res.redirect(`${QBO_AUTH_URL}?${params.toString()}`);
});

// Intuit redirects here after the user approves access.
router.get('/callback', async (req, res) => {
  const { code, state, realmId, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`QuickBooks authorization failed: ${error_description || error}`);
  }
  if (!code || !realmId) {
    return res.status(400).send('Missing code or realmId from QuickBooks callback');
  }
  if (req.session.qbo_oauth_state && state !== req.session.qbo_oauth_state) {
    return res.status(400).send('Invalid state — possible CSRF attempt. Try connecting again.');
  }
  delete req.session.qbo_oauth_state;

  // Exchange the authorization code for tokens.
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    const resp = await fetch(QBO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: getRedirectUri(req)
      })
    });

    if (!resp.ok) {
      const text = await resp.text();
      const sentRedirectUri = getRedirectUri(req);
      console.error('[qbo-callback] token exchange failed', {
        status: resp.status,
        statusText: resp.statusText,
        body: text,
        redirect_uri_sent: sentRedirectUri,
        client_id_prefix: (clientId || '').slice(0, 12) + '…'
      });
      return res.status(500).type('text/plain').send(
        `Token exchange failed.\n\n` +
        `HTTP Status: ${resp.status} ${resp.statusText}\n` +
        `Response body: ${text || '(empty)'}\n\n` +
        `Redirect URI we sent: ${sentRedirectUri}\n` +
        `Client ID prefix: ${(clientId || '').slice(0, 12)}…\n\n` +
        `Check: (1) the redirect URI saved in Intuit exactly matches what we sent above, ` +
        `(2) QBO_CLIENT_ID and QBO_CLIENT_SECRET env vars match the values from Intuit's Development tab.`
      );
    }

    const tokens = await resp.json();
    // tokens: { access_token, refresh_token, expires_in (3600),
    //           x_refresh_token_expires_in (8726400 ≈ 101 days), token_type }

    const now = new Date();
    const accessExpiresAt = new Date(now.getTime() + (tokens.expires_in || 3600) * 1000).toISOString();
    const refreshExpiresAt = new Date(now.getTime() + (tokens.x_refresh_token_expires_in || 8726400) * 1000).toISOString();

    const db = getDb();
    db.prepare('DELETE FROM quickbooks_connection').run();
    db.prepare(`
      INSERT INTO quickbooks_connection (
        realm_id, access_token, refresh_token, access_expires_at, refresh_expires_at, environment
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      String(realmId),
      tokens.access_token,
      tokens.refresh_token,
      accessExpiresAt,
      refreshExpiresAt,
      process.env.QBO_ENVIRONMENT || 'sandbox'
    );

    if (req.session && req.session.userId) {
      logAudit(db, 'quickbooks', 0, req.session.userId, 'connected', { realm_id: realmId });
    }

    // Bounce back to Settings with a success flag the UI can read.
    res.redirect('/app#settings?qbo=connected');
  } catch (err) {
    console.error('[qbo-callback] unexpected error:', err);
    res.status(500).send(`Callback handler crashed: ${err.message}`);
  }
});

// Disconnect — wipes stored tokens. Doesn't revoke them with Intuit
// (that's a separate API call we may add later); the user can also
// revoke from inside their QuickBooks settings.
router.post('/disconnect', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM quickbooks_connection').run();
  logAudit(db, 'quickbooks', 0, req.session.userId, 'disconnected', {});
  res.json({ disconnected: true });
});

// Connection status — used by the Settings UI to show whether to render
// "Connect" or "Connected ✓ / Disconnect".
router.get('/status', requireAuth, (req, res) => {
  const db = getDb();
  const conn = qbo.getConnection(db);
  if (!conn) return res.json({ connected: false });
  res.json({
    connected: true,
    realm_id: conn.realm_id,
    environment: conn.environment,
    connected_at: conn.connected_at,
    access_expires_at: conn.access_expires_at,
    refresh_expires_at: conn.refresh_expires_at,
    last_refreshed_at: conn.last_refreshed_at
  });
});

// Smoke test — fetches the company info from QBO. If this works, the
// integration is working end-to-end. Surface this from the Settings UI
// after connecting so the user knows it actually talks to QB.
router.get('/company-info', requireAuth, async (req, res) => {
  const db = getDb();
  try {
    const data = await qbo.qboFetch(db, 'companyinfo/' + qbo.getConnection(db).realm_id);
    const info = data && data.CompanyInfo;
    res.json({
      ok: true,
      company_name: info?.CompanyName,
      legal_name: info?.LegalName,
      country: info?.Country,
      fiscal_year_start: info?.FiscalYearStartMonth
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
