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

// Get inventory for a specific product
router.get('/:productId', requireAuth, (req, res) => {
  const db = getDb();
  const inv = db.prepare(`
    SELECT i.*, p.name as product_name, p.unit_of_measure
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE i.product_id = ?
  `).get(req.params.productId);

  if (!inv) return res.status(404).json({ error: 'Inventory record not found' });
  res.json(inv);
});

// Get inventory change history for a product
router.get('/:productId/log', requireAuth, (req, res) => {
  const db = getDb();
  const logs = db.prepare(`
    SELECT il.*, u.full_name as user_name
    FROM inventory_log il
    LEFT JOIN users u ON u.id = il.user_id
    WHERE il.product_id = ?
    ORDER BY il.created_at DESC
    LIMIT 100
  `).all(req.params.productId);

  res.json(logs);
});

// Adjust inventory
router.post('/adjust', requireAuth, (req, res) => {
  const { product_id, change_amount, reason, application_id } = req.body;

  if (!product_id || change_amount === undefined) {
    return res.status(400).json({ error: 'Product ID and change amount required' });
  }

  const db = getDb();

  const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(product_id);
  if (!inv) return res.status(404).json({ error: 'Inventory record not found' });

  const newQty = inv.quantity + Number(change_amount);
  db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
    .run(newQty, product_id);

  db.prepare(
    'INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)'
  ).run(product_id, change_amount, reason || 'adjustment', application_id || null, req.session.userId);

  res.json({ product_id, new_quantity: newQty });
});

// Bulk receive inventory (season intake / delivery)
router.post('/receive', requireAuth, (req, res) => {
  const { items, po_number } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  const db = getDb();
  const results = [];

  const receiveAll = db.transaction(() => {
    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        throw new Error('Invalid item: product_id=' + item.product_id + ', quantity=' + item.quantity);
      }

      const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(item.product_id);
      if (!inv) throw new Error('No inventory record for product_id=' + item.product_id);

      const newQty = inv.quantity + Number(item.quantity);
      db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
        .run(newQty, item.product_id);

      const reason = po_number ? 'received (PO: ' + po_number + ')' : 'received';
      db.prepare(
        'INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)'
      ).run(item.product_id, Number(item.quantity), reason, null, req.session.userId);

      results.push({ product_id: item.product_id, new_quantity: newQty });
    }
  });

  try {
    receiveAll();
    res.json({ success: true, items: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update reorder threshold
router.put('/:productId/threshold', requireAuth, (req, res) => {
  const { reorder_threshold } = req.body;

  if (reorder_threshold == null || reorder_threshold < 0) {
    return res.status(400).json({ error: 'Valid reorder threshold required' });
  }

  const db = getDb();
  const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(req.params.productId);
  if (!inv) return res.status(404).json({ error: 'Inventory record not found' });

  db.prepare('UPDATE inventory SET reorder_threshold = ? WHERE product_id = ?')
    .run(Number(reorder_threshold), req.params.productId);

  res.json({ success: true, reorder_threshold: Number(reorder_threshold) });
});

module.exports = router;
