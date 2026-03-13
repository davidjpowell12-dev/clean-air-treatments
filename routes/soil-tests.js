const express = require('express');
const path = require('path');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// File upload setup (same pattern as IPM)
let upload;
try {
  const multer = require('multer');
  const { v4: uuidv4 } = require('uuid');
  const storage = multer.diskStorage({
    destination: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'soil-' + uuidv4() + ext);
    }
  });
  upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
} catch (e) {
  upload = { single: () => (req, res, next) => next() };
}

// List soil tests for a property (newest first)
router.get('/property/:propertyId', requireAuth, (req, res) => {
  const db = getDb();
  const tests = db.prepare(`
    SELECT st.*, u.full_name as created_by_name
    FROM soil_tests st
    LEFT JOIN users u ON u.id = st.created_by
    WHERE st.property_id = ?
    ORDER BY st.test_date DESC
  `).all(req.params.propertyId);
  res.json(tests);
});

// Get single soil test
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const test = db.prepare(`
    SELECT st.*, u.full_name as created_by_name
    FROM soil_tests st
    LEFT JOIN users u ON u.id = st.created_by
    WHERE st.id = ?
  `).get(req.params.id);
  if (!test) return res.status(404).json({ error: 'Soil test not found' });
  res.json(test);
});

// Create soil test
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { property_id, test_date } = req.body;

  if (!property_id || !test_date) {
    return res.status(400).json({ error: 'Property ID and test date are required' });
  }

  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(property_id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const fields = [
    'property_id', 'test_date', 'lab_name', 'lab_number', 'sample_depth_inches',
    'ph', 'buffer_ph', 'organic_matter_pct', 'cec',
    'nitrogen_ppm', 'phosphorus_ppm', 'potassium_ppm',
    'calcium_ppm', 'magnesium_ppm', 'sulfur_ppm',
    'phosphorus_lbs_acre',
    'calcium_lbs_acre', 'calcium_desired_lbs_acre',
    'magnesium_lbs_acre', 'magnesium_desired_lbs_acre',
    'potassium_lbs_acre', 'potassium_desired_lbs_acre',
    'sodium_lbs_acre',
    'base_sat_calcium_pct', 'base_sat_magnesium_pct',
    'base_sat_potassium_pct', 'base_sat_sodium_pct',
    'base_sat_other_pct', 'base_sat_hydrogen_pct',
    'boron_ppm', 'iron_ppm', 'manganese_ppm',
    'copper_ppm', 'zinc_ppm', 'aluminum_ppm',
    'recommendations', 'notes'
  ];

  const values = fields.map(f => {
    const v = req.body[f];
    return v !== undefined && v !== '' ? v : null;
  });

  // Add created_by
  fields.push('created_by');
  values.push(req.session.userId);

  const placeholders = fields.map(() => '?').join(', ');
  const result = db.prepare(
    `INSERT INTO soil_tests (${fields.join(', ')}) VALUES (${placeholders})`
  ).run(...values);

  const created = db.prepare('SELECT * FROM soil_tests WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'soil_test', created.id, req.session.userId, 'create', created);
  res.json(created);
});

// Update soil test
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM soil_tests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Soil test not found' });

  const fields = [
    'test_date', 'lab_name', 'lab_number', 'sample_depth_inches',
    'ph', 'buffer_ph', 'organic_matter_pct', 'cec',
    'nitrogen_ppm', 'phosphorus_ppm', 'potassium_ppm',
    'calcium_ppm', 'magnesium_ppm', 'sulfur_ppm',
    'phosphorus_lbs_acre',
    'calcium_lbs_acre', 'calcium_desired_lbs_acre',
    'magnesium_lbs_acre', 'magnesium_desired_lbs_acre',
    'potassium_lbs_acre', 'potassium_desired_lbs_acre',
    'sodium_lbs_acre',
    'base_sat_calcium_pct', 'base_sat_magnesium_pct',
    'base_sat_potassium_pct', 'base_sat_sodium_pct',
    'base_sat_other_pct', 'base_sat_hydrogen_pct',
    'boron_ppm', 'iron_ppm', 'manganese_ppm',
    'copper_ppm', 'zinc_ppm', 'aluminum_ppm',
    'recommendations', 'notes'
  ];

  const setClauses = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => {
    const v = req.body[f];
    return v !== undefined && v !== '' ? v : null;
  });
  values.push(req.params.id);

  db.prepare(
    `UPDATE soil_tests SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(...values);

  const updated = db.prepare('SELECT * FROM soil_tests WHERE id = ?').get(req.params.id);
  logAudit(db, 'soil_test', updated.id, req.session.userId, 'update', { before: existing, after: updated });
  res.json(updated);
});

// Delete soil test
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM soil_tests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Soil test not found' });

  db.prepare('DELETE FROM soil_tests WHERE id = ?').run(req.params.id);
  logAudit(db, 'soil_test', existing.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// Upload lab report (PDF/image) to a soil test
router.post('/:id/upload', requireAuth, upload.single('report'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const db = getDb();
  const test = db.prepare('SELECT id FROM soil_tests WHERE id = ?').get(req.params.id);
  if (!test) return res.status(404).json({ error: 'Soil test not found' });

  db.prepare(
    'UPDATE soil_tests SET file_path = ?, original_filename = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(req.file.filename, req.file.originalname, req.params.id);

  res.json({ file_path: req.file.filename, original_filename: req.file.originalname });
});

// Serve lab report file
router.get('/:id/report', requireAuth, (req, res) => {
  const db = getDb();
  const test = db.prepare('SELECT file_path, original_filename FROM soil_tests WHERE id = ?').get(req.params.id);
  if (!test || !test.file_path) return res.status(404).json({ error: 'No report file found' });

  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
  res.sendFile(path.join(uploadsDir, test.file_path));
});

module.exports = router;
