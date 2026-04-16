const express = require('express');
const path = require('path');
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// File upload setup for sales order PDFs
let upload;
try {
  const multer = require('multer');
  const { v4: uuidv4 } = require('uuid');
  const storage = multer.diskStorage({
    destination: process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, 'so-' + uuidv4() + ext);
    }
  });
  upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
} catch (e) {
  upload = { single: () => (req, res, next) => next() };
}

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

// Bulk receive inventory (season intake / delivery) + create purchase records
// Accepts multipart/form-data with optional sales_order PDF upload
router.post('/receive', requireAuth, upload.single('sales_order'), (req, res) => {
  // Parse items from FormData (JSON string) or JSON body
  let items, po_number, vendor_name, purchase_date, received_date;
  if (req.body.items && typeof req.body.items === 'string') {
    try { items = JSON.parse(req.body.items); } catch (e) { items = null; }
    po_number = req.body.po_number || null;
    vendor_name = req.body.vendor_name || null;
    purchase_date = req.body.purchase_date || null;
    received_date = req.body.received_date || null;
  } else {
    ({ items, po_number, vendor_name, purchase_date, received_date } = req.body);
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one item is required' });
  }

  // If a PDF was uploaded, record its path (shared across all purchase rows in this delivery)
  const salesOrderPath = req.file ? req.file.filename : null;
  const salesOrderOriginalName = req.file ? req.file.originalname : null;

  const db = getDb();
  const results = [];
  const today = new Date().toISOString().split('T')[0];

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

      // Create formal purchase record for COGS tracking
      const unitCost = item.unit_cost != null ? Number(item.unit_cost) : null;
      const totalCost = (unitCost != null) ? unitCost * Number(item.quantity) : null;

      db.prepare(`
        INSERT INTO purchases (product_id, quantity, unit_cost, total_cost, po_number, vendor_name, purchase_date, received_date, sales_order_path, sales_order_original_name, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.product_id,
        Number(item.quantity),
        unitCost,
        totalCost,
        po_number || null,
        vendor_name || null,
        purchase_date || today,
        received_date || today,
        salesOrderPath,
        salesOrderOriginalName,
        req.session.userId
      );

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
