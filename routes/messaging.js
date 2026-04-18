// Messaging: SMS drafts for service heads-ups and completion notifications.
//
// The flow:
// 1. /compose/heads-ups?date=YYYY-MM-DD generates drafts for scheduled visits
//    on that date (default: tomorrow). Idempotent — won't duplicate existing drafts.
// 2. GET /drafts?type=heads_up|completion&status=draft — list drafts for review.
// 3. PUT /drafts/:id — edit text.
// 4. POST /drafts/:id/send — send individually (via Twilio, or dry-run).
// 5. POST /drafts/send-all?type=... — bulk send.
// 6. DELETE /drafts/:id — skip / discard a draft.
//
// Completion drafts are created by routes/applications.js when a tech logs
// an application; see `createCompletionDraft` below (exported for that use).

const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { composeHeadsUp, composeCompletion } = require('../utils/message-composer');
const { sendSms, isConfigured } = require('../utils/twilio');

const router = express.Router();

// Simple helper to get tomorrow's date as YYYY-MM-DD in local time
function tomorrowLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Is Twilio live? (Used in responses so UI can show a dry-run banner.)
router.get('/status', requireAuth, (req, res) => {
  res.json({
    twilio_configured: isConfigured(),
    mode: isConfigured() ? 'live' : 'dry-run'
  });
});

// Generate heads-up drafts for visits on a given date. Default = tomorrow.
// Idempotent: skips properties that already have an undeleted draft for that
// date. Returns counts of created, skipped, and total.
router.post('/compose/heads-ups', requireAuth, (req, res) => {
  const db = getDb();
  const date = (req.body && req.body.date) || tomorrowLocal();

  // Pull all scheduled visits for that day that aren't already completed
  const visits = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.phone, p.sms_opted_in
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    WHERE s.scheduled_date = ?
      AND s.status != 'completed'
      AND s.status != 'cancelled'
    ORDER BY p.customer_name
  `).all(date);

  let created = 0, skipped_existing = 0, skipped_opted_out = 0, skipped_no_phone = 0;
  const createdDrafts = [];

  for (const v of visits) {
    // Skip if an active draft already exists for this schedule
    const existing = db.prepare(`
      SELECT id FROM message_drafts
      WHERE schedule_id = ? AND type = 'heads_up' AND status IN ('draft','sent')
    `).get(v.id);
    if (existing) { skipped_existing++; continue; }

    if (v.sms_opted_in === 0) { skipped_opted_out++; continue; }
    if (!v.phone || !v.phone.trim()) { skipped_no_phone++; continue; }

    const composedText = composeHeadsUp(db, v, v);
    const result = db.prepare(`
      INSERT INTO message_drafts (
        property_id, schedule_id, type, service_date, service_summary,
        composed_text, to_phone, status
      ) VALUES (?, ?, 'heads_up', ?, ?, ?, ?, 'draft')
    `).run(
      v.property_id, v.id, v.scheduled_date, v.service_type || '',
      composedText, v.phone
    );
    createdDrafts.push(result.lastInsertRowid);
    created++;
  }

  logAudit(db, 'message_compose', 0, req.session.userId, 'compose_heads_ups', {
    date, created, skipped_existing, skipped_opted_out, skipped_no_phone
  });

  res.json({
    date,
    created,
    skipped_existing,
    skipped_opted_out,
    skipped_no_phone,
    draft_ids: createdDrafts
  });
});

// Helper that other routes (applications.js) call to create a completion draft.
// Exported on module.exports so it can be require()'d from elsewhere.
function createCompletionDraft(db, application, options) {
  options = options || {};
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(application.property_id);
  if (!property) return { error: 'no_property' };

  // Dedupe: don't create multiple completion drafts for the same application
  const existing = db.prepare(`
    SELECT id FROM message_drafts WHERE application_id = ? AND type = 'completion'
  `).get(application.id);
  if (existing) return { skipped: 'already_exists', draft_id: existing.id };

  if (property.sms_opted_in === 0) return { skipped: 'opted_out' };
  if (!property.phone || !property.phone.trim()) return { skipped: 'no_phone' };

  // If the application has a schedule_id, get the richer service_type from there
  let serviceType = application.product_name || '';
  if (application.schedule_id) {
    const sched = db.prepare('SELECT service_type FROM schedules WHERE id = ?').get(application.schedule_id);
    if (sched && sched.service_type) serviceType = sched.service_type;
  }

  const composedText = composeCompletion(db, application, property, serviceType);
  const result = db.prepare(`
    INSERT INTO message_drafts (
      property_id, application_id, schedule_id, type, service_date, service_summary,
      composed_text, to_phone, status
    ) VALUES (?, ?, ?, 'completion', ?, ?, ?, ?, 'draft')
  `).run(
    property.id, application.id, application.schedule_id || null,
    application.application_date, serviceType,
    composedText, property.phone
  );
  return { created: true, draft_id: result.lastInsertRowid };
}

// List drafts with filters
router.get('/drafts', requireAuth, (req, res) => {
  const db = getDb();
  const { type, status, date } = req.query;

  let sql = `
    SELECT d.*, p.customer_name, p.address, p.city
    FROM message_drafts d
    LEFT JOIN properties p ON p.id = d.property_id
  `;
  const conditions = [];
  const params = [];
  if (type) { conditions.push('d.type = ?'); params.push(type); }
  if (status) { conditions.push('d.status = ?'); params.push(status); }
  else conditions.push("d.status = 'draft'");
  if (date) { conditions.push('d.service_date = ?'); params.push(date); }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY d.service_date DESC, d.created_at DESC';

  res.json(db.prepare(sql).all(...params));
});

// Counts for dashboard widget
router.get('/drafts/counts', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'heads_up' AND status = 'draft' THEN 1 ELSE 0 END) as heads_up_ready,
      SUM(CASE WHEN type = 'completion' AND status = 'draft' THEN 1 ELSE 0 END) as completion_ready,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM message_drafts
  `).get();
  res.json({
    heads_up_ready: row.heads_up_ready || 0,
    completion_ready: row.completion_ready || 0,
    failed: row.failed || 0
  });
});

// Get single draft
router.get('/drafts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT d.*, p.customer_name, p.address, p.city, p.phone as property_phone
    FROM message_drafts d
    LEFT JOIN properties p ON p.id = d.property_id
    WHERE d.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Draft not found' });
  res.json(row);
});

// Update draft (typically the edited_text or to_phone)
router.put('/drafts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Draft not found' });
  if (existing.status === 'sent') return res.status(400).json({ error: 'Cannot edit a sent draft' });

  const b = req.body || {};
  db.prepare(`
    UPDATE message_drafts SET
      edited_text = ?, to_phone = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    b.edited_text !== undefined ? b.edited_text : existing.edited_text,
    b.to_phone !== undefined ? b.to_phone : existing.to_phone,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(req.params.id));
});

// Send a draft (live Twilio if configured, dry-run otherwise)
router.post('/drafts/:id/send', requireAuth, async (req, res) => {
  const db = getDb();
  const draft = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(req.params.id);
  if (!draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.status === 'sent') return res.status(400).json({ error: 'Already sent' });

  const body = draft.edited_text || draft.composed_text;
  const result = await sendSms(draft.to_phone, body);

  if (result.success) {
    db.prepare(`
      UPDATE message_drafts SET
        status = 'sent', sent_at = CURRENT_TIMESTAMP, sent_by = ?,
        send_result = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(req.session.userId, JSON.stringify(result), draft.id);
  } else {
    db.prepare(`
      UPDATE message_drafts SET
        status = 'failed', send_result = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(result), draft.id);
  }

  logAudit(db, 'message_draft', draft.id, req.session.userId, 'send', result);

  res.json({ ...result, draft_id: draft.id });
});

// Bulk send — sends all drafts of a given type in draft status.
// Runs sequentially to avoid Twilio rate-limit spikes.
router.post('/drafts/send-all', requireAuth, async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const type = b.type; // 'heads_up' or 'completion'
  const date = b.date || null;

  let sql = "SELECT * FROM message_drafts WHERE status = 'draft'";
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (date) { sql += ' AND service_date = ?'; params.push(date); }

  const drafts = db.prepare(sql).all(...params);
  const results = [];

  for (const d of drafts) {
    const body = d.edited_text || d.composed_text;
    const r = await sendSms(d.to_phone, body);
    if (r.success) {
      db.prepare(`
        UPDATE message_drafts SET status = 'sent', sent_at = CURRENT_TIMESTAMP,
          sent_by = ?, send_result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(req.session.userId, JSON.stringify(r), d.id);
    } else {
      db.prepare(`
        UPDATE message_drafts SET status = 'failed', send_result = ?,
          updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(JSON.stringify(r), d.id);
    }
    results.push({ draft_id: d.id, ...r });
  }

  logAudit(db, 'message_draft', 0, req.session.userId, 'send_all', {
    type, date, total: results.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  });

  res.json({
    total: results.length,
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    dry_run: results.length > 0 && results.every(r => r.dry_run),
    results
  });
});

// Skip / discard a draft
router.delete('/drafts/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM message_drafts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Draft not found' });
  db.prepare("UPDATE message_drafts SET status = 'skipped', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(req.params.id);
  logAudit(db, 'message_draft', Number(req.params.id), req.session.userId, 'skip', {});
  res.json({ success: true });
});

// Per-property SMS opt-in toggle
router.put('/property/:id/opt-in', requireAuth, (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const val = b.sms_opted_in ? 1 : 0;
  db.prepare('UPDATE properties SET sms_opted_in = ? WHERE id = ?').run(val, req.params.id);
  logAudit(db, 'property', Number(req.params.id), req.session.userId, 'sms_opt_change', { sms_opted_in: val });
  res.json({ success: true, sms_opted_in: val });
});

// ─── Twilio inbound webhook (STOP/HELP/START keyword handling) ──────────
// Twilio POSTs here when a customer texts our number. Handles the
// required compliance keywords:
//   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT → opt out
//   START / UNSTOP / YES                               → opt back in
//   HELP / INFO                                        → send help response
// Anything else is logged so the admin can see it in the app.
//
// NO AUTH — Twilio signs requests rather than using a session. In production
// we should verify the signature, but for now we accept all POSTs and just
// process keywords. Public URL is /api/messaging/twilio-webhook.
router.post('/twilio-webhook', express.urlencoded({ extended: false }), (req, res) => {
  const db = getDb();
  const from = req.body.From || '';      // e.g. "+16165551234"
  const body = (req.body.Body || '').trim();
  const bodyUpper = body.toUpperCase();

  // Normalize phone — strip "+1" to match our stored format variants
  const digits = from.replace(/\D/g, '');
  const last10 = digits.slice(-10);

  let responseMessage = '';
  let action = 'received';

  const STOP_KEYWORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
  const START_KEYWORDS = ['START', 'UNSTOP', 'YES'];
  const HELP_KEYWORDS = ['HELP', 'INFO'];

  if (STOP_KEYWORDS.includes(bodyUpper)) {
    action = 'opt_out';
    // Find any property whose phone matches (various format tolerant) and flip
    const properties = db.prepare(`
      SELECT id, customer_name, phone FROM properties
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'(',''),')','') LIKE ?
    `).all('%' + last10);
    for (const p of properties) {
      db.prepare('UPDATE properties SET sms_opted_in = 0 WHERE id = ?').run(p.id);
      logAudit(db, 'property', p.id, null, 'sms_opt_out_via_stop', { phone: from });
    }
    // Twilio auto-sends the "You've been unsubscribed" confirmation when STOP is detected
    // by their system, so we don't need to reply. Empty TwiML is fine.
    responseMessage = '';
  } else if (START_KEYWORDS.includes(bodyUpper)) {
    action = 'opt_in';
    const properties = db.prepare(`
      SELECT id FROM properties
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone,'-',''),' ',''),'(',''),')','') LIKE ?
    `).all('%' + last10);
    for (const p of properties) {
      db.prepare('UPDATE properties SET sms_opted_in = 1 WHERE id = ?').run(p.id);
      logAudit(db, 'property', p.id, null, 'sms_opt_in_via_start', { phone: from });
    }
    responseMessage = 'You are resubscribed to Clean Air Lawn Care service notifications. Reply STOP to unsubscribe.';
  } else if (HELP_KEYWORDS.includes(bodyUpper)) {
    action = 'help';
    responseMessage = 'Clean Air Lawn Care (Evolved Lawn and Garden LLC). For help, call (616) 822-5876 or email dave@cleanairlawncare.com. Reply STOP to unsubscribe. Msg&data rates may apply.';
  } else {
    // Not a keyword — log as an inbound message for review.
    // We don't auto-reply to free-form text; admin can follow up via the UI.
    action = 'inbound_message';
  }

  try {
    logAudit(db, 'sms_inbound', 0, null, action, {
      from, body: body.slice(0, 200), action
    });
  } catch (e) { /* non-fatal */ }

  // Respond with TwiML (Twilio expects XML response)
  res.type('text/xml');
  if (responseMessage) {
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(responseMessage)}</Message></Response>`);
  } else {
    res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
module.exports.createCompletionDraft = createCompletionDraft;
