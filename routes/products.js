const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List all products
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { search, type } = req.query;

  let sql = 'SELECT * FROM products';
  const params = [];
  const conditions = [];

  if (search) {
    conditions.push('(name LIKE ? OR epa_reg_number LIKE ? OR active_ingredients LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  if (type) {
    conditions.push('product_type = ?');
    params.push(type);
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  sql += ' ORDER BY name';
  const products = db.prepare(sql).all(...params);
  res.json(products);
});

// Get single product
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

// Create product (admin)
router.post('/', requireAdmin, (req, res) => {
  const db = getDb();
  const fields = [
    'name', 'epa_reg_number', 'active_ingredients', 'product_type', 'formulation',
    'unit_of_measure', 'package_size', 'cost_per_unit',
    'app_rate_low', 'app_rate_high', 'app_rate_unit',
    'mix_rate_oz_per_gal', 'spray_volume_gal_per_1000',
    'is_restricted_use', 'signal_word', 'rei_hours', 'data_sheet_url', 'notes'
  ];

  const values = fields.map(f => req.body[f] !== undefined && req.body[f] !== '' ? req.body[f] : null);
  const placeholders = fields.map(() => '?').join(', ');

  const result = db.prepare(
    `INSERT INTO products (${fields.join(', ')}) VALUES (${placeholders})`
  ).run(...values);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
  res.json(product);
});

// Update product (admin)
router.put('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const fields = [
    'name', 'epa_reg_number', 'active_ingredients', 'product_type', 'formulation',
    'unit_of_measure', 'package_size', 'cost_per_unit',
    'app_rate_low', 'app_rate_high', 'app_rate_unit',
    'mix_rate_oz_per_gal', 'spray_volume_gal_per_1000',
    'is_restricted_use', 'signal_word', 'rei_hours', 'data_sheet_url', 'notes'
  ];

  const setClauses = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => req.body[f] !== undefined && req.body[f] !== '' ? req.body[f] : null);
  values.push(req.params.id);

  db.prepare(
    `UPDATE products SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(...values);

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  res.json(product);
});

// Delete product (admin)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
