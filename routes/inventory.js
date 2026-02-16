const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get all inventory with product info
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const inventory = db.prepare(`
    SELECT i.*, p.name as product_name, p.product_type, p.unit_of_measure
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    ORDER BY p.name
  `).all();
  res.json(inventory);
});

// Adjust inventory
router.post('/adjust', requireAuth, (req, res) => {
  const { product_id, change_amount, reason, application_id } = req.body;

  if (!product_id || change_amount === undefined) {
    return res.status(400).json({ error: 'Product ID and change amount required' });
  }

  const db = getDb();

  // Update inventory
  const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(product_id);
  if (!inv) return res.status(404).json({ error: 'Inventory record not found' });

  const newQty = inv.quantity + Number(change_amount);
  db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
    .run(newQty, product_id);

  // Log the change
  db.prepare(
    'INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)'
  ).run(product_id, change_amount, reason || 'adjustment', application_id || null, req.session.userId);

  res.json({ product_id, new_quantity: newQty });
});

module.exports = router;
