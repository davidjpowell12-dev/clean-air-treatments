const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// List follow-ups with optional filters
// Query params: status (open/done/all), bucket (today/this_week/someday),
//   property_id, waiting_on (me/customer)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { status, bucket, property_id, waiting_on, include_snoozed } = req.query;

  let sql = `
    SELECT f.*,
           p.customer_name, p.address, p.city,
           u.full_name as created_by_name
    FROM follow_ups f
    LEFT JOIN properties p ON p.id = f.property_id
    LEFT JOIN users u ON u.id = f.created_by
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

  // Hide snoozed items unless asked for
  if (!include_snoozed) {
    conditions.push('(f.snoozed_until IS NULL OR f.snoozed_until <= CURRENT_TIMESTAMP)');
  }

  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ` ORDER BY f.pinned DESC,
             CASE f.bucket WHEN 'today' THEN 0 WHEN 'this_week' THEN 1 ELSE 2 END,
             f.created_at DESC`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// Counts by bucket for dashboard widget
router.get('/counts', requireAuth, (req, res) => {
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN bucket = 'today' THEN 1 ELSE 0 END) as today,
      SUM(CASE WHEN bucket = 'this_week' THEN 1 ELSE 0 END) as this_week,
      SUM(CASE WHEN bucket = 'someday' THEN 1 ELSE 0 END) as someday,
      SUM(CASE WHEN waiting_on = 'customer' THEN 1 ELSE 0 END) as waiting_customer,
      SUM(CASE WHEN waiting_on = 'me' THEN 1 ELSE 0 END) as waiting_me,
      COUNT(*) as total
    FROM follow_ups
    WHERE status = 'open'
      AND (snoozed_until IS NULL OR snoozed_until <= CURRENT_TIMESTAMP)
  `).get();

  res.json({
    today: counts.today || 0,
    this_week: counts.this_week || 0,
    someday: counts.someday || 0,
    waiting_customer: counts.waiting_customer || 0,
    waiting_me: counts.waiting_me || 0,
    total: counts.total || 0
  });
});

// Create follow-up
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const b = req.body || {};

  if (!b.title || !b.title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const result = db.prepare(`
    INSERT INTO follow_ups (property_id, title, notes, bucket, waiting_on, pinned, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    b.property_id || null,
    b.title.trim(),
    b.notes || null,
    b.bucket || 'today',
    b.waiting_on || 'me',
    b.pinned ? 1 : 0,
    req.session.userId
  );

  logAudit(db, 'follow_up', result.lastInsertRowid, req.session.userId, 'create', {
    title: b.title, property_id: b.property_id
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
      pinned = ?, property_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    b.title !== undefined ? b.title : existing.title,
    b.notes !== undefined ? b.notes : existing.notes,
    b.bucket !== undefined ? b.bucket : existing.bucket,
    b.waiting_on !== undefined ? b.waiting_on : existing.waiting_on,
    b.pinned !== undefined ? (b.pinned ? 1 : 0) : existing.pinned,
    b.property_id !== undefined ? (b.property_id || null) : existing.property_id,
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

module.exports = router;
