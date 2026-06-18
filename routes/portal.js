// Client portal routes (Phase 0: auth only — no customer UI yet).
// Mounted at /portal. Magic-link sign-in:
//   POST /portal/request-link  → email/SMS a one-time link (anti-enumeration)
//   GET  /portal/auth?token=   → consume link, set session cookie
//   POST /portal/logout        → clear session
//   GET  /portal/session       → current client (behind requireClient)
const express = require('express');
const path = require('path');
const router = express.Router();
const { getDb } = require('../db/database');
const clientAuth = require('../utils/client-auth');
const clients = require('../utils/clients');
const portalData = require('../utils/portal-data');
const email = require('../utils/email');

const COOKIE = 'cat_portal_session';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/portal',
  maxAge: clientAuth.SESSION_TTL_MS,
};

// Minimal cookie parser (the app has no cookie-parser; express-session keeps
// its own). We only need our one portal cookie.
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Auth gate for every future portal API route. Sets req.clientId.
function requireClient(req, res, next) {
  const clientId = clientAuth.validateSession(getDb(), readCookie(req, COOKIE));
  if (!clientId) return res.status(401).json({ error: 'Not signed in' });
  req.clientId = clientId;
  next();
}

// Find a client by email or phone (last-10-digits match), or null.
function findClient(db, { email: emailInput, phone }) {
  if (emailInput) {
    const norm = clients.normalizeEmail(emailInput);
    return norm ? db.prepare('SELECT * FROM clients WHERE email = ?').get(norm) : null;
  }
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 10) return null;
    const last10 = digits.slice(-10);
    return db.prepare('SELECT * FROM clients WHERE phone IS NOT NULL').all()
      .find(c => String(c.phone).replace(/\D/g, '').endsWith(last10)) || null;
  }
  return null;
}

// Always responds identically whether or not the account exists.
router.post('/request-link', async (req, res) => {
  const SAME = { ok: true, message: "If that account exists, we've sent a sign-in link." };
  try {
    const db = getDb();
    const client = findClient(db, req.body || {});
    if (client) {
      const channel = (req.body && req.body.email) ? 'email' : 'sms';
      const token = clientAuth.createLoginToken(db, client.id, channel);
      const url = `${req.protocol}://${req.get('host')}/portal/auth?token=${token}`;
      if (channel === 'email' && client.email && email.isEnabled()) {
        email.sendMagicLinkEmail({ to: client.email, customerName: client.name, magicUrl: url })
          .catch(e => console.error('[portal] magic-link email failed:', e.message));
      } else {
        // SMS dispatch + email-disabled fallback land here. Logged so it's
        // recoverable; full SMS wiring comes with the Phase 1 UI.
        console.log(`[portal] sign-in link for client ${client.id} (${channel}): ${url}`);
      }
    }
    res.json(SAME);
  } catch (err) {
    console.error('[portal] request-link:', err.message);
    res.json(SAME); // never leak failure detail
  }
});

// Magic-link target. Consumes the token, starts a session, sets the cookie.
router.get('/auth', (req, res) => {
  try {
    const db = getDb();
    const clientId = clientAuth.consumeLoginToken(db, req.query.token);
    if (!clientId) {
      return res.status(400).send(authPage('This sign-in link is invalid or has expired. Please request a new one.'));
    }
    const session = clientAuth.createSession(db, clientId);
    res.cookie(COOKIE, session, COOKIE_OPTS);
    res.redirect('/portal/home');
  } catch (err) {
    console.error('[portal] /auth error:', err.message);
    res.status(400).send(authPage('This sign-in link is invalid or has expired. Please request a new one.'));
  }
});

// ─── Customer-facing page (login + dashboard SPA) ────────────
const PAGE = path.join(__dirname, '..', 'public', 'portal.html');
router.get('/', (req, res) => res.sendFile(PAGE));
router.get('/home', (req, res) => res.sendFile(PAGE));

// ─── Portal data API (all behind requireClient, all scoped) ──
router.get('/me', requireClient, (req, res) => {
  const client = getDb().prepare('SELECT id, email, name FROM clients WHERE id = ?').get(req.clientId);
  res.json({ ok: true, client });
});

router.get('/invoices', requireClient, (req, res) => {
  res.json({ ok: true, ...portalData.getClientInvoices(getDb(), req.clientId) });
});

router.get('/visits', requireClient, (req, res) => {
  res.json({ ok: true, ...portalData.getClientVisits(getDb(), req.clientId) });
});

router.get('/payments', requireClient, (req, res) => {
  res.json({ ok: true, ...portalData.getClientPayments(getDb(), req.clientId) });
});

router.post('/logout', (req, res) => {
  clientAuth.destroySession(getDb(), readCookie(req, COOKIE));
  res.clearCookie(COOKIE, { path: '/portal' });
  res.json({ ok: true });
});

// Smoke endpoint proving the session + middleware work end to end.
router.get('/session', requireClient, (req, res) => {
  const client = getDb().prepare('SELECT id, email, name FROM clients WHERE id = ?').get(req.clientId);
  res.json({ ok: true, client });
});

function authPage(message, ok = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Clean Air Lawn Care</title></head>
  <body style="font-family:system-ui,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;text-align:center;color:#1f2937">
    <h1 style="color:#3a6324;font-size:22px">Clean Air Lawn Care</h1>
    <p style="font-size:16px;color:${ok ? '#256029' : '#9a3540'};margin-top:24px">${ok ? '✓ ' : ''}${message}</p>
  </body></html>`;
}

router.requireClient = requireClient;
module.exports = router;
