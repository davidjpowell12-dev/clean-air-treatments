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

// ─── Invoice Sync ─────────────────────────────────────────────
const qboSync = require('../utils/quickbooks-sync');

// Push a single invoice to QBO. Idempotent — skips if already synced.
router.post('/sync-invoice/:id', requireAdmin, async (req, res) => {
  const db = getDb();
  try {
    const result = await qboSync.pushInvoiceToQbo(db, parseInt(req.params.id, 10));
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[qbo-sync-invoice] error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Bulk push: every CAT invoice that's pending/paid and not yet in QBO.
// Scheduled invoices are skipped (they're not "due" yet, no AR to track).
router.post('/sync-pending', requireAdmin, async (req, res) => {
  const db = getDb();
  const pending = db.prepare(`
    SELECT id, invoice_number FROM invoices
     WHERE status IN ('pending', 'paid')
       AND qbo_invoice_id IS NULL
       AND status != 'void'
     ORDER BY id ASC
  `).all();

  const results = [];
  let succeeded = 0, failed = 0;
  for (const inv of pending) {
    try {
      const r = await qboSync.pushInvoiceToQbo(db, inv.id);
      results.push({ invoice_number: inv.invoice_number, success: true, ...r });
      succeeded++;
    } catch (err) {
      results.push({ invoice_number: inv.invoice_number, success: false, error: err.message });
      failed++;
    }
  }
  res.json({ ok: true, total: pending.length, succeeded, failed, results });
});

// Bulk push of PAID invoices, fully settled: for each paid invoice not yet
// fully synced, push the invoice (if needed) then record the payment in QBO
// so it lands marked Paid — carrying the Stripe pi / check number as the
// reference. Idempotent and safe to re-run: invoices already paid in QBO
// (incl. manually-recorded ones) are detected via balance check and skipped.
router.post('/sync-paid', requireAdmin, async (req, res) => {
  const db = getDb();
  // Optional limit: lets the controller push a small test batch (e.g. the
  // first 3) before committing to the whole set. Same ordering as the preview
  // so "test 3" pushes exactly the 3 rows shown at the top of the preview.
  const limit = Number.isInteger(req.body?.limit) && req.body.limit > 0 ? req.body.limit : null;
  // "Needs syncing" = paid but not yet processed. We key off
  // qbo_payment_synced_at (set on BOTH a successful payment AND the
  // "already paid in QBO" skip) rather than qbo_payment_id, so invoices we
  // intentionally skipped don't reappear forever (qbo_payment_id stays NULL
  // for those because we never created a payment).
  const paid = db.prepare(`
    SELECT id, invoice_number FROM invoices
     WHERE status = 'paid'
       AND qbo_payment_synced_at IS NULL
     ORDER BY id ASC
     ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : []));

  const results = [];
  let succeeded = 0, failed = 0, paymentsApplied = 0, alreadyPaid = 0;
  for (const inv of paid) {
    try {
      const r = await qboSync.syncPaidInvoiceToQbo(db, inv.id);
      if (r.payment?.success) paymentsApplied++;
      else if (r.payment?.reason === 'already paid in QBO') alreadyPaid++;
      results.push({ invoice_number: inv.invoice_number, success: true, ...r });
      succeeded++;
    } catch (err) {
      results.push({ invoice_number: inv.invoice_number, success: false, error: err.message });
      failed++;
    }
  }
  res.json({ ok: true, total: paid.length, succeeded, failed, paymentsApplied, alreadyPaid, results });
});

// Dry-run preview for the bulk paid-invoice push. Returns the exact list of
// invoices the /sync-paid button would process — same filter as that endpoint
// (status='paid' and not yet payment-synced) — so the controller can eyeball
// customer, amount, and the payment reference before anything is sent to QBO.
// Read-only: makes no QBO calls and writes nothing.
router.get('/sync-paid/preview', requireAdmin, async (req, res) => {
  const db = getDb();
  const reqLimit = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(reqLimit) && reqLimit > 0 ? reqLimit : null;
  // total = how many would be pushed with no limit (so the UI can say
  // "showing 3 of 107"); rows = the (optionally limited) batch to display.
  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM invoices
     WHERE status = 'paid' AND qbo_payment_synced_at IS NULL
  `).get().n;
  const rows = db.prepare(`
    SELECT
      i.invoice_number, i.amount_cents, i.payment_method,
      i.stripe_payment_intent_id, i.check_number,
      i.qbo_invoice_id,
      e.customer_name
    FROM invoices i
    JOIN estimates e ON e.id = i.estimate_id
    WHERE i.status = 'paid'
      AND i.qbo_payment_synced_at IS NULL
    ORDER BY i.id ASC
    ${limit ? 'LIMIT ?' : ''}
  `).all(...(limit ? [limit] : []));

  const invoices = rows.map(r => ({
    invoice_number: r.invoice_number,
    customer_name: r.customer_name,
    amount: r.amount_cents / 100,
    payment_method: r.payment_method || 'unknown',
    reference: r.payment_method === 'check'
      ? (r.check_number ? `Check #${r.check_number}` : '(no check #)')
      : (r.stripe_payment_intent_id || '(no reference)'),
    already_in_qbo: !!r.qbo_invoice_id
  }));

  res.json({ ok: true, total, shown: invoices.length, limit, invoices });
});

// Reconciliation: compares CAT invoice totals to QBO invoice totals for
// every synced invoice. Surfaces any drift so the controller can spot
// manual edits or partial syncs.
router.get('/reconcile', requireAuth, async (req, res) => {
  const db = getDb();
  const synced = db.prepare(`
    SELECT id, invoice_number, amount_cents, qbo_invoice_id, qbo_synced_at, status
      FROM invoices
     WHERE qbo_invoice_id IS NOT NULL
     ORDER BY id DESC
     LIMIT 500
  `).all();

  const rows = [];
  for (const inv of synced) {
    try {
      const data = await qbo.qboFetch(db, 'invoice/' + inv.qbo_invoice_id);
      const qboTotalCents = Math.round((data?.Invoice?.TotalAmt || 0) * 100);
      const drift = qboTotalCents - inv.amount_cents;
      rows.push({
        invoice_number: inv.invoice_number,
        cat_amount: inv.amount_cents / 100,
        qbo_amount: qboTotalCents / 100,
        drift_cents: drift,
        qbo_invoice_id: inv.qbo_invoice_id,
        status: inv.status
      });
    } catch (err) {
      rows.push({
        invoice_number: inv.invoice_number,
        cat_amount: inv.amount_cents / 100,
        qbo_amount: null,
        error: err.message,
        qbo_invoice_id: inv.qbo_invoice_id,
        status: inv.status
      });
    }
  }

  const withDrift = rows.filter(r => r.drift_cents && r.drift_cents !== 0).length;
  const errors = rows.filter(r => r.error).length;
  res.json({ ok: true, checked: rows.length, with_drift: withDrift, errors, rows });
});

// Debug: dump a QBO invoice + its customer + the CAT-side data so we can
// see exactly what got created (vs what we think we created). Visible JSON.
// Accepts either the numeric DB id or the invoice_number (CA-2026-XXXX).
router.get('/debug/invoice/:catInvoiceId', requireAdmin, async (req, res) => {
  const db = getDb();
  try {
    const idParam = req.params.catInvoiceId;
    const catInv = /^\d+$/.test(idParam)
      ? db.prepare('SELECT * FROM invoices WHERE id = ?').get(parseInt(idParam, 10))
      : db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(idParam);
    if (!catInv) return res.status(404).json({ error: 'Invoice not found in app' });

    // Fetch QBO data only if synced — otherwise we still want the CAT-side dump.
    let qboInvoice = null, qboCustomer = null;
    if (catInv.qbo_invoice_id) {
      try {
        qboInvoice = await qbo.qboFetch(db, 'invoice/' + catInv.qbo_invoice_id);
        const customerRef = qboInvoice?.Invoice?.CustomerRef?.value;
        if (customerRef) {
          qboCustomer = await qbo.qboFetch(db, 'customer/' + customerRef);
        }
      } catch (e) {
        qboInvoice = { error: e.message };
      }
    }

    const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(catInv.estimate_id);
    const property = estimate?.property_id
      ? db.prepare('SELECT * FROM properties WHERE id = ?').get(estimate.property_id)
      : null;
    const estimateItems = estimate
      ? db.prepare('SELECT id, service_id, service_name, price, is_recurring, rounds, is_included, sort_order FROM estimate_items WHERE estimate_id = ? ORDER BY sort_order, id').all(estimate.id)
      : [];
    const siblingInvoices = estimate
      ? db.prepare('SELECT id, invoice_number, amount_cents, status, installment_number, total_installments FROM invoices WHERE estimate_id = ? ORDER BY COALESCE(installment_number, 0), id').all(estimate.id)
      : [];

    res.json({
      ok: true,
      cat_invoice: {
        id: catInv.id,
        invoice_number: catInv.invoice_number,
        amount_cents: catInv.amount_cents,
        status: catInv.status,
        payment_plan: catInv.payment_plan,
        installment_number: catInv.installment_number,
        total_installments: catInv.total_installments,
        qbo_invoice_id: catInv.qbo_invoice_id,
        qbo_synced_at: catInv.qbo_synced_at
      },
      cat_estimate: estimate ? {
        id: estimate.id,
        customer_name: estimate.customer_name,
        email: estimate.email,
        property_id: estimate.property_id,
        total_price: estimate.total_price,
        monthly_price: estimate.monthly_price,
        payment_months: estimate.payment_months,
        payment_plan: estimate.payment_plan
      } : null,
      cat_estimate_items: estimateItems,
      cat_sibling_invoices: siblingInvoices,
      cat_property: property ? { id: property.id, customer_name: property.customer_name, email: property.email, qbo_customer_id: property.qbo_customer_id } : null,
      qbo_invoice: qboInvoice?.Invoice || qboInvoice,
      qbo_customer: qboCustomer?.Customer || qboCustomer
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// List CAT invoices with QBO sync status — for the Settings panel.
router.get('/sync-status', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      i.id, i.invoice_number, i.amount_cents, i.status, i.payment_plan,
      i.qbo_invoice_id, i.qbo_synced_at, i.qbo_sync_error,
      e.customer_name
    FROM invoices i
    JOIN estimates e ON e.id = i.estimate_id
    WHERE i.status IN ('pending', 'paid')
    ORDER BY i.id DESC
    LIMIT 200
  `).all();
  res.json({ ok: true, invoices: rows });
});

module.exports = router;
