const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get daily schedule (with property + tech info)
router.get('/daily', requireAuth, (req, res) => {
  const db = getDb();
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date parameter required' });

  const entries = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft, p.phone,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.scheduled_date = ?
    ORDER BY s.sort_order, s.id
  `).all(date);

  res.json(entries);
});

// Get week overview (count per day for a week)
router.get('/week', requireAuth, (req, res) => {
  const db = getDb();
  const { start } = req.query;
  if (!start) return res.status(400).json({ error: 'Start date required' });

  // Get 7 days starting from start
  const days = db.prepare(`
    SELECT scheduled_date,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
    FROM schedules
    WHERE scheduled_date >= ? AND scheduled_date < date(?, '+7 days')
    GROUP BY scheduled_date
    ORDER BY scheduled_date
  `).all(start, start);

  res.json(days);
});

// Get unscheduled properties for a given date (to add to schedule)
router.get('/unscheduled', requireAuth, (req, res) => {
  const db = getDb();
  const { date, search } = req.query;
  if (!date) return res.status(400).json({ error: 'Date parameter required' });

  let sql = `
    SELECT p.* FROM properties p
    WHERE p.id NOT IN (SELECT property_id FROM schedules WHERE scheduled_date = ?)
  `;
  const params = [date];

  if (search) {
    sql += ' AND (p.customer_name LIKE ? OR p.address LIKE ? OR p.city LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  sql += ' ORDER BY p.customer_name LIMIT 50';
  res.json(db.prepare(sql).all(...params));
});

// Get single schedule entry
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const entry = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft, p.phone,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.id = ?
  `).get(req.params.id);

  if (!entry) return res.status(404).json({ error: 'Schedule entry not found' });
  res.json(entry);
});

// Add properties to schedule (bulk)
router.post('/bulk', requireAuth, (req, res) => {
  const db = getDb();
  const { property_ids, scheduled_date, assigned_to } = req.body;

  if (!Array.isArray(property_ids) || !scheduled_date) {
    return res.status(400).json({ error: 'property_ids array and scheduled_date required' });
  }

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max FROM schedules WHERE scheduled_date = ?'
  ).get(scheduled_date);

  const stmt = db.prepare(`
    INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((ids) => {
    let added = 0;
    let order = maxOrder.max;
    for (const pid of ids) {
      // Skip if already scheduled for that date
      const existing = db.prepare(
        'SELECT id FROM schedules WHERE property_id = ? AND scheduled_date = ?'
      ).get(pid, scheduled_date);
      if (existing) continue;

      order++;
      stmt.run(pid, scheduled_date, assigned_to || null, order, req.session.userId);
      added++;
    }
    return added;
  });

  const added = insertMany(property_ids);
  logAudit(db, 'schedule', 0, req.session.userId, 'bulk_add', { date: scheduled_date, count: added });
  res.json({ added });
});

// Create single schedule entry
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { property_id, scheduled_date, assigned_to, notes } = req.body;

  if (!property_id || !scheduled_date) {
    return res.status(400).json({ error: 'property_id and scheduled_date required' });
  }

  // Check not already scheduled
  const existing = db.prepare(
    'SELECT id FROM schedules WHERE property_id = ? AND scheduled_date = ?'
  ).get(property_id, scheduled_date);
  if (existing) return res.status(400).json({ error: 'Property already scheduled for this date' });

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max FROM schedules WHERE scheduled_date = ?'
  ).get(scheduled_date);

  const result = db.prepare(`
    INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(property_id, scheduled_date, assigned_to || null, maxOrder.max + 1, notes || null, req.session.userId);

  const entry = db.prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'schedule', entry.id, req.session.userId, 'create', entry);
  res.json(entry);
});

// Update schedule entry (status, notes, assigned_to, sort_order)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });

  const { status, notes, assigned_to, sort_order } = req.body;

  db.prepare(`
    UPDATE schedules SET
      status = COALESCE(?, status),
      notes = ?,
      assigned_to = ?,
      sort_order = COALESCE(?, sort_order),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    status || null,
    notes !== undefined ? notes : existing.notes,
    assigned_to !== undefined ? assigned_to : existing.assigned_to,
    sort_order != null ? sort_order : null,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.id = ?
  `).get(req.params.id);

  logAudit(db, 'schedule', req.params.id, req.session.userId, 'update', { before: existing, after: updated });
  res.json(updated);
});

// Reorder entries for a date
router.put('/reorder/:date', requireAuth, (req, res) => {
  const db = getDb();
  const { order } = req.body; // array of schedule IDs in desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const stmt = db.prepare('UPDATE schedules SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND scheduled_date = ?');
  const reorder = db.transaction(() => {
    order.forEach((id, idx) => {
      stmt.run(idx + 1, id, req.params.date);
    });
  });
  reorder();

  res.json({ success: true });
});

// Delete schedule entry
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });

  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  logAudit(db, 'schedule', req.params.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// Assign tech to all entries for a date
router.put('/assign-all/:date', requireAuth, (req, res) => {
  const db = getDb();
  const { assigned_to } = req.body;

  const result = db.prepare(
    'UPDATE schedules SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE scheduled_date = ?'
  ).run(assigned_to || null, req.params.date);

  res.json({ updated: result.changes });
});

// Get technicians list
router.get('/meta/technicians', requireAuth, (req, res) => {
  const db = getDb();
  const techs = db.prepare("SELECT id, full_name, role FROM users ORDER BY full_name").all();
  res.json(techs);
});

module.exports = router;
