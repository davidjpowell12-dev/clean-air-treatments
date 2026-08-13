const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Today's date in Michigan local time as YYYY-MM-DD. The server clock is UTC
// on Railway, so a plain toISOString() would roll over to "tomorrow" during
// the evening and flag items overdue a day early.
function localDateStr(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
}

// Add days to a YYYY-MM-DD string using pure calendar math. Done in UTC on a
// date-only value so it can't drift across a DST boundary, and so it stays
// consistent with whatever "today" it was handed (deriving tomorrow from
// Date.now() instead let the two disagree).
function addDaysStr(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Exported helper: mark any follow-ups linked to this estimate as done.
// Called when an estimate transitions to 'accepted' (customer-facing and admin).
function autoCompleteLinkedFollowUps(db, estimateId, userId) {
  try {
    const linked = db.prepare(
      "SELECT id FROM follow_ups WHERE linked_estimate_id = ? AND status = 'open'"
    ).all(estimateId);
    if (!linked.length) return 0;

    const update = db.prepare(`
      UPDATE follow_ups SET
        status = 'done',
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    for (const f of linked) {
      update.run(f.id);
      try {
        logAudit(db, 'follow_up', f.id, userId || null, 'auto_complete', {
          reason: 'linked_estimate_accepted', estimate_id: estimateId
        });
      } catch (e) { /* audit failures non-fatal */ }
    }
    console.log(`[follow-ups] Auto-completed ${linked.length} follow-up(s) for accepted estimate ${estimateId}`);
    return linked.length;
  } catch (err) {
    console.error('[follow-ups] autoCompleteLinkedFollowUps failed:', err.message);
    return 0;
  }
}

// List follow-ups with optional filters
// Query params: status (open/done/all), bucket (today/this_week/someday),
//   property_id, waiting_on (me/customer)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { status, bucket, property_id, waiting_on, include_snoozed, kind, undated } = req.query;

  let sql = `
    SELECT f.*,
           p.customer_name, p.address, p.city,
           u.full_name as created_by_name,
           e.status as linked_estimate_status
    FROM follow_ups f
    LEFT JOIN properties p ON p.id = f.property_id
    LEFT JOIN users u ON u.id = f.created_by
    LEFT JOIN estimates e ON e.id = f.linked_estimate_id
  `;
  const conditions = [];
  const params = [];

  // Default to open only
  if (!status || status === 'open') {
    conditions.push("f.status = 'open'");
  } else if (status !== 'all') {
    conditions.push('f.status = ?');
    params.push(status);
  }

  if (bucket) {
    conditions.push('f.bucket = ?');
    params.push(bucket);
  }
  if (property_id) {
    conditions.push('f.property_id = ?');
    params.push(Number(property_id));
  }
  if (waiting_on) {
    conditions.push('f.waiting_on = ?');
    params.push(waiting_on);
  }
  if (kind) {
    conditions.push('f.kind = ?');
    params.push(kind);
  }
  // The Unsorted pile: captured but never given a date.
  if (undated === '1') {
    conditions.push('f.due_date IS NULL');
  }

  // Hide snoozed items unless asked for
  if (!include_snoozed) {
    conditions.push('(f.snoozed_until IS NULL OR f.snoozed_until <= CURRENT_TIMESTAMP)');
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  // Urgency order, not recency. Previously this sorted newest-first, which
  // pushed the most-neglected item to the BOTTOM — the opposite of what a
  // to-do list needs. Now: pinned, then soonest/most-overdue due date, then
  // undated (triage later), oldest-first as the tiebreak so stale things rise.
  sql += ` ORDER BY f.pinned DESC,
             CASE WHEN f.due_date IS NULL THEN 1 ELSE 0 END,
             f.due_date ASC,
             f.created_at ASC`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// Counts by bucket for dashboard widget
router.get('/counts', requireAuth, (req, res) => {
  const db = getDb();
  // Date comparisons use local time, not UTC — the server clock is UTC on
  // Railway, so a UTC "today" would flip a day early in the evening and mark
  // things overdue before they are.
  const today = localDateStr();
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN bucket = 'today' THEN 1 ELSE 0 END) as today_bucket,
      SUM(CASE WHEN bucket = 'this_week' THEN 1 ELSE 0 END) as this_week,
      SUM(CASE WHEN bucket = 'someday' THEN 1 ELSE 0 END) as someday,
      SUM(CASE WHEN waiting_on = 'customer' THEN 1 ELSE 0 END) as waiting_customer,
      SUM(CASE WHEN waiting_on = 'me' THEN 1 ELSE 0 END) as waiting_me,
      SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) as due_today,
      SUM(CASE WHEN due_date IS NULL THEN 1 ELSE 0 END) as unsorted,
      COUNT(*) as total
    FROM follow_ups
    WHERE status = 'open'
      AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
  `).get(today, today);

  res.json({
    today: counts.today_bucket || 0,
    this_week: counts.this_week || 0,
    someday: counts.someday || 0,
    waiting_customer: counts.waiting_customer || 0,
    waiting_me: counts.waiting_me || 0,
    overdue: counts.overdue || 0,
    due_today: counts.due_today || 0,
    unsorted: counts.unsorted || 0,
    total: counts.total || 0
  });
});

// On-demand digest preview, so the evening summary can be checked without
// waiting for the cron. MUST stay above '/:id' or Express matches it as an id.
router.get('/digest', requireAuth, (req, res) => {
  res.json(buildFollowUpDigest(getDb()));
});

// Create follow-up
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const b = req.body || {};

  if (!b.title || !b.title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const result = db.prepare(`
    INSERT INTO follow_ups (property_id, title, notes, bucket, waiting_on, pinned,
                            due_date, kind, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.property_id || null,
    b.title.trim(),
    b.notes || null,
    b.bucket || 'today',
    b.waiting_on || 'me',
    b.pinned ? 1 : 0,
    // Both optional so quick-capture stays one tap. No date = Unsorted pile.
    b.due_date || null,
    b.kind || null,
    req.session.userId
  );

  logAudit(db, 'follow_up', result.lastInsertRowid, req.session.userId, 'create', {
    title: b.title, property_id: b.property_id, due_date: b.due_date || null, kind: b.kind || null
  });

  const created = db.prepare(`
    SELECT f.*, p.customer_name, p.address
    FROM follow_ups f
    LEFT JOIN properties p ON p.id = f.property_id
    WHERE f.id = ?
  `).get(result.lastInsertRowid);

  res.json(created);
});

// Get single follow-up
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT f.*, p.customer_name, p.address, p.city,
           u.full_name as created_by_name
    FROM follow_ups f
    LEFT JOIN properties p ON p.id = f.property_id
    LEFT JOIN users u ON u.id = f.created_by
    WHERE f.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: 'Follow-up not found' });
  res.json(row);
});

// Update follow-up
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });

  const b = req.body || {};

  db.prepare(`
    UPDATE follow_ups SET
      title = ?, notes = ?, bucket = ?, waiting_on = ?,
      pinned = ?, property_id = ?, due_date = ?, kind = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    b.title !== undefined ? b.title : existing.title,
    b.notes !== undefined ? b.notes : existing.notes,
    b.bucket !== undefined ? b.bucket : existing.bucket,
    b.waiting_on !== undefined ? b.waiting_on : existing.waiting_on,
    b.pinned !== undefined ? (b.pinned ? 1 : 0) : existing.pinned,
    b.property_id !== undefined ? (b.property_id || null) : existing.property_id,
    // Empty string clears the date (back to Unsorted) rather than being
    // coerced to a bogus value.
    b.due_date !== undefined ? (b.due_date || null) : existing.due_date,
    b.kind !== undefined ? (b.kind || null) : existing.kind,
    req.params.id
  );

  logAudit(db, 'follow_up', Number(req.params.id), req.session.userId, 'update', {
    before: existing, after: b
  });

  const updated = db.prepare(`
    SELECT f.*, p.customer_name, p.address
    FROM follow_ups f
    LEFT JOIN properties p ON p.id = f.property_id
    WHERE f.id = ?
  `).get(req.params.id);

  res.json(updated);
});

// Mark done
router.post('/:id/complete', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });

  db.prepare(`
    UPDATE follow_ups SET
      status = 'done',
      completed_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  logAudit(db, 'follow_up', Number(req.params.id), req.session.userId, 'complete', {});

  res.json({ success: true });
});

// Reopen
router.post('/:id/reopen', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });

  db.prepare(`
    UPDATE follow_ups SET
      status = 'open',
      completed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  logAudit(db, 'follow_up', Number(req.params.id), req.session.userId, 'reopen', {});

  res.json({ success: true });
});

// Snooze until a specific date (or N days from now if `days` supplied)
router.post('/:id/snooze', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });

  const b = req.body || {};
  let snoozeUntil = b.until;
  if (!snoozeUntil && b.days) {
    const d = new Date();
    d.setDate(d.getDate() + Number(b.days));
    snoozeUntil = d.toISOString();
  }
  if (!snoozeUntil) return res.status(400).json({ error: 'Provide "until" or "days"' });

  db.prepare(`
    UPDATE follow_ups SET
      snoozed_until = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(snoozeUntil, req.params.id);

  logAudit(db, 'follow_up', Number(req.params.id), req.session.userId, 'snooze', {
    until: snoozeUntil
  });

  res.json({ success: true, snoozed_until: snoozeUntil });
});

// Toggle pin
router.post('/:id/pin', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });

  const newPin = existing.pinned ? 0 : 1;
  db.prepare(`
    UPDATE follow_ups SET pinned = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(newPin, req.params.id);

  res.json({ success: true, pinned: newPin });
});

// Convert a follow-up to a draft estimate.
// Requires the follow-up to be linked to a property. Creates a minimal
// draft estimate pre-filled with the customer's info, links the two,
// and returns the new estimate id so the UI can navigate to it.
router.post('/:id/convert-to-estimate', requireAuth, (req, res) => {
  const db = getDb();
  const fu = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!fu) return res.status(404).json({ error: 'Follow-up not found' });
  if (!fu.property_id) {
    return res.status(400).json({ error: 'Follow-up must be linked to a customer before converting to estimate' });
  }
  if (fu.linked_estimate_id) {
    // Already converted — just return the existing estimate id
    return res.json({ estimate_id: fu.linked_estimate_id, already_linked: true });
  }

  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(fu.property_id);
  if (!prop) return res.status(400).json({ error: 'Property not found' });

  // Create minimal draft estimate (no items yet — user will add in editor)
  const token = crypto.randomBytes(32).toString('hex');
  const insert = db.prepare(`
    INSERT INTO estimates (
      property_id, customer_name, address, city, state, zip,
      email, phone, property_sqft, total_price, monthly_price,
      payment_months, token, status, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 8, ?, 'draft', ?)
  `);
  const result = insert.run(
    prop.id,
    prop.customer_name,
    prop.address || '',
    prop.city || '',
    prop.state || 'MI',
    prop.zip || '',
    prop.email || '',
    prop.phone || '',
    prop.sqft || null,
    token,
    req.session.userId
  );
  const estimateId = result.lastInsertRowid;

  // Link follow-up to the new estimate
  db.prepare('UPDATE follow_ups SET linked_estimate_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(estimateId, fu.id);

  logAudit(db, 'follow_up', fu.id, req.session.userId, 'convert_to_estimate', {
    estimate_id: estimateId, customer_name: prop.customer_name
  });
  logAudit(db, 'estimate', estimateId, req.session.userId, 'created_from_followup', {
    follow_up_id: fu.id, follow_up_title: fu.title
  });

  res.json({ estimate_id: estimateId, already_linked: false });
});

// Delete
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Follow-up not found' });

  db.prepare('DELETE FROM follow_ups WHERE id = ?').run(req.params.id);

  logAudit(db, 'follow_up', Number(req.params.id), req.session.userId, 'delete', {
    title: existing.title
  });

  res.json({ success: true });
});

// ─── Daily digest ────────────────────────────────────────────────────
// Follow-ups were entirely pull-based: they only existed if you remembered to
// open the page, so items quietly aged out of mind. This composes the "what
// needs you" summary the evening cron pushes out.
//
// Returns { total, overdue, due_today, due_tomorrow, unsorted, text } — or
// total: 0 when there's nothing worth interrupting for.
function buildFollowUpDigest(db, { today = localDateStr() } = {}) {
  const tomorrow = addDaysStr(today, 1);

  const open = db.prepare(`
    SELECT f.title, f.due_date, f.kind, f.waiting_on, p.customer_name
      FROM follow_ups f
      LEFT JOIN properties p ON p.id = f.property_id
     WHERE f.status = 'open'
       AND (f.snoozed_until IS NULL OR f.snoozed_until <= CURRENT_TIMESTAMP)
     ORDER BY f.due_date ASC, f.created_at ASC
  `).all();

  const overdue = open.filter(f => f.due_date && f.due_date < today);
  const dueToday = open.filter(f => f.due_date === today);
  const dueTomorrow = open.filter(f => f.due_date === tomorrow);
  const unsorted = open.filter(f => !f.due_date);

  const total = overdue.length + dueToday.length + dueTomorrow.length;
  // Only nag when something is actually dated and due. An Unsorted backlog
  // alone isn't worth a daily interruption — it's reported as context when
  // there's already something to say.
  if (total === 0) {
    return { total: 0, overdue: 0, due_today: 0, due_tomorrow: 0, unsorted: unsorted.length, text: null };
  }

  const label = (f) => {
    const who = f.customer_name ? `${f.customer_name}: ` : '';
    return `• ${who}${f.title}`;
  };
  const lines = [];
  if (overdue.length) {
    lines.push(`OVERDUE (${overdue.length}):`);
    overdue.slice(0, 10).forEach(f => lines.push(label(f)));
    if (overdue.length > 10) lines.push(`…and ${overdue.length - 10} more`);
    lines.push('');
  }
  if (dueToday.length) {
    lines.push(`DUE TODAY (${dueToday.length}):`);
    dueToday.slice(0, 10).forEach(f => lines.push(label(f)));
    lines.push('');
  }
  if (dueTomorrow.length) {
    lines.push(`TOMORROW (${dueTomorrow.length}):`);
    dueTomorrow.slice(0, 10).forEach(f => lines.push(label(f)));
    lines.push('');
  }
  if (unsorted.length) {
    lines.push(`${unsorted.length} unsorted follow-up${unsorted.length === 1 ? '' : 's'} still need a date.`);
  }

  return {
    total,
    overdue: overdue.length,
    due_today: dueToday.length,
    due_tomorrow: dueTomorrow.length,
    unsorted: unsorted.length,
    text: lines.join('\n').trim()
  };
}

module.exports = router;
module.exports.autoCompleteLinkedFollowUps = autoCompleteLinkedFollowUps;
module.exports.buildFollowUpDigest = buildFollowUpDigest;
