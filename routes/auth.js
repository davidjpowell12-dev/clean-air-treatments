const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.fullName = user.full_name;
  req.session.role = user.role;
  req.session.applicatorCertNumber = user.applicator_cert_number;

  res.json({
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    applicatorCertNumber: user.applicator_cert_number
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Get current user
router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.session.userId,
    username: req.session.username,
    fullName: req.session.fullName,
    role: req.session.role,
    applicatorCertNumber: req.session.applicatorCertNumber
  });
});

// List users (admin)
router.get('/users', requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, username, full_name, role, applicator_cert_number, created_at FROM users ORDER BY full_name'
  ).all();
  res.json(users);
});

// Create user (admin)
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, fullName, role, applicatorCertNumber } = req.body;
  if (!username || !password || !fullName) {
    return res.status(400).json({ error: 'Username, password, and full name required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, applicator_cert_number) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, fullName, role || 'technician', applicatorCertNumber || null);

  res.json({ id: result.lastInsertRowid, username, fullName, role: role || 'technician' });
});

// Update user (admin)
router.put('/users/:id', requireAdmin, (req, res) => {
  const { fullName, role, applicatorCertNumber, password } = req.body;
  const db = getDb();

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  }

  db.prepare(
    'UPDATE users SET full_name = COALESCE(?, full_name), role = COALESCE(?, role), applicator_cert_number = COALESCE(?, applicator_cert_number) WHERE id = ?'
  ).run(fullName || null, role || null, applicatorCertNumber !== undefined ? applicatorCertNumber : null, req.params.id);

  res.json({ success: true });
});

// Delete user (admin, cannot delete self)
router.delete('/users/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
