const express = require('express');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List audit log entries (admin only)
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const { record_type, record_id, user_id, limit } = req.query;

  let sql = `
    SELECT al.*, u.full_name as user_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
  `;
  const params = [];
  const conditions = [];

  if (record_type) {
    conditions.push('al.record_type = ?');
    params.push(record_type);
  }
  if (record_id) {
    conditions.push('al.record_id = ?');
    params.push(Number(record_id));
  }
  if (user_id) {
    conditions.push('al.user_id = ?');
    params.push(Number(user_id));
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY al.created_at DESC LIMIT ?';
  params.push(Number(limit) || 100);

  res.json(db.prepare(sql).all(...params));
});

module.exports = router;
