const express = require('express');
const path = require('path');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Valid status transitions
const VALID_TRANSITIONS = {
  'active': ['monitoring', 'resolved'],
  'monitoring': ['active', 'resolved'],
  'resolved': ['active']
};

// List cases (optionally filtered by property_id or status)
router.get('/cases', requireAuth, (req, res) => {
  const db = getDb();
  const { property_id, status } = req.query;

  let sql = `
    SELECT ic.*, u.full_name as created_by_name, p.customer_name, p.address,
           (SELECT COUNT(*) FROM ipm_observations WHERE case_id = ic.id) as observation_count
    FROM ipm_cases ic
    LEFT JOIN users u ON u.id = ic.created_by
    LEFT JOIN properties p ON p.id = ic.property_id
  `;
  const params = [];
  const conditions = [];

  if (property_id) { conditions.push('ic.property_id = ?'); params.push(Number(property_id)); }
  if (status) { conditions.push('ic.status = ?'); params.push(status); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ic.created_at DESC';

  res.json(db.prepare(sql).all(...params));
});

// Get single case with observations and photos
router.get('/cases/:id', requireAuth, (req, res) => {
  const db = getDb();
  const caseRow = db.prepare(`
    SELECT ic.*, u.full_name as created_by_name, p.customer_name, p.address
    FROM ipm_cases ic
    LEFT JOIN users u ON u.id = ic.created_by
    LEFT JOIN properties p ON p.id = ic.property_id
    WHERE ic.id = ?
  `).get(req.params.id);

  if (!caseRow) return res.status(404).json({ error: 'Case not found' });

  const observations = db.prepare(`
    SELECT o.*, u.full_name as created_by_name
    FROM ipm_observations o
    LEFT JOIN users u ON u.id = o.created_by
    WHERE o.case_id = ?
    ORDER BY o.created_at ASC
  `).all(req.params.id);

  // Attach photos to each observation
  for (const obs of observations) {
    obs.photos = db.prepare('SELECT * FROM ipm_photos WHERE observation_id = ?').all(obs.id);
  }

  caseRow.observations = observations;
  res.json(caseRow);
});

// Create case
router.post('/cases', requireAuth, (req, res) => {
  const db = getDb();
  const { property_id, issue_description } = req.body;

  if (!property_id || !issue_description) {
    return res.status(400).json({ error: 'Property ID and issue description required' });
  }

  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(property_id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const result = db.prepare(`
    INSERT INTO ipm_cases (property_id, issue_description, created_by) VALUES (?, ?, ?)
  `).run(property_id, issue_description, req.session.userId);

  const created = db.prepare('SELECT * FROM ipm_cases WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'ipm_case', created.id, req.session.userId, 'create', created);
  res.json(created);
});

// Update case (status transitions)
router.put('/cases/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM ipm_cases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Case not found' });

  const { status, issue_description } = req.body;

  if (status && status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: `Cannot transition from ${existing.status} to ${status}` });
    }
  }

  const newStatus = status || existing.status;
  const resolvedAt = newStatus === 'resolved' ? new Date().toISOString() : (newStatus !== 'resolved' ? null : existing.resolved_at);

  db.prepare(`
    UPDATE ipm_cases SET status = ?, issue_description = COALESCE(?, issue_description), resolved_at = ?
    WHERE id = ?
  `).run(newStatus, issue_description || null, resolvedAt, req.params.id);

  const updated = db.prepare('SELECT * FROM ipm_cases WHERE id = ?').get(req.params.id);
  logAudit(db, 'ipm_case', updated.id, req.session.userId, 'update', { before: existing, after: updated });
  res.json(updated);
});

// Add observation to case
router.post('/cases/:id/observations', requireAuth, (req, res) => {
  const db = getDb();
  const caseRow = db.prepare('SELECT id FROM ipm_cases WHERE id = ?').get(req.params.id);
  if (!caseRow) return res.status(404).json({ error: 'Case not found' });

  const { notes } = req.body;
  if (!notes) return res.status(400).json({ error: 'Notes required' });

  const result = db.prepare(`
    INSERT INTO ipm_observations (case_id, notes, created_by) VALUES (?, ?, ?)
  `).run(req.params.id, notes, req.session.userId);

  const obs = db.prepare('SELECT * FROM ipm_observations WHERE id = ?').get(result.lastInsertRowid);
  obs.photos = [];
  res.json(obs);
});

// Upload photo to observation (requires multer — deferred until `npm install multer`)
let upload;
try {
  const multer = require('multer');
  const { v4: uuidv4 } = require('uuid');
  const storage = multer.diskStorage({
    destination: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, uuidv4() + ext);
    }
  });
  upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
} catch (e) {
  // multer not installed yet — create a stub
  upload = { single: () => (req, res, next) => next() };
}

router.post('/observations/:id/photos', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo file uploaded' });

  const db = getDb();
  const obs = db.prepare('SELECT id FROM ipm_observations WHERE id = ?').get(req.params.id);
  if (!obs) return res.status(404).json({ error: 'Observation not found' });

  const result = db.prepare(`
    INSERT INTO ipm_photos (observation_id, file_path, original_filename) VALUES (?, ?, ?)
  `).run(req.params.id, req.file.filename, req.file.originalname);

  res.json({ id: result.lastInsertRowid, file_path: req.file.filename });
});

// Serve photo file
router.get('/photos/:id', requireAuth, (req, res) => {
  const db = getDb();
  const photo = db.prepare('SELECT * FROM ipm_photos WHERE id = ?').get(req.params.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  res.sendFile(path.join(uploadsDir, photo.file_path));
});

module.exports = router;
