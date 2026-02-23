const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// List purchases with optional date filtering
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { from, to, month, product_id } = req.query;

  let sql = `
    SELECT p.*, pr.name as product_name, pr.product_type, pr.unit_of_measure,
           u.full_name as created_by_name
    FROM purchases p
    JOIN products pr ON pr.id = p.product_id
    LEFT JOIN users u ON u.id = p.created_by
  `;
  const params = [];
  const conditions = [];

  if (month) {
    conditions.push("p.purchase_date >= ? AND p.purchase_date < date(?, '+1 month')");
    params.push(month + '-01', month + '-01');
  } else {
    if (from) { conditions.push('p.purchase_date >= ?'); params.push(from); }
    if (to) { conditions.push('p.purchase_date <= ?'); params.push(to); }
  }

  if (product_id) {
    conditions.push('p.product_id = ?');
    params.push(Number(product_id));
  }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.purchase_date DESC, p.created_at DESC';

  res.json(db.prepare(sql).all(...params));
});

// Export COGS CSV (must be before /:id)
router.get('/export', requireAuth, (req, res) => {
  const db = getDb();
  const { from, to, month } = req.query;

  let sql = `
    SELECT p.*, pr.name as product_name, pr.product_type, pr.unit_of_measure
    FROM purchases p
    JOIN products pr ON pr.id = p.product_id
  `;
  const params = [];
  const conditions = [];

  if (month) {
    conditions.push("p.purchase_date >= ? AND p.purchase_date < date(?, '+1 month')");
    params.push(month + '-01', month + '-01');
  } else {
    if (from) { conditions.push('p.purchase_date >= ?'); params.push(from); }
    if (to) { conditions.push('p.purchase_date <= ?'); params.push(to); }
  }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY p.purchase_date ASC, p.created_at ASC';

  const purchases = db.prepare(sql).all(...params);

  const headers = [
    'Date', 'PO #', 'Vendor', 'Product Name', 'Product Type',
    'Quantity', 'Unit', 'Unit Cost', 'Line Total'
  ];

  const rows = purchases.map(p => [
    p.purchase_date,
    p.po_number || '',
    p.vendor_name || '',
    p.product_name,
    p.product_type,
    p.quantity,
    p.unit_of_measure,
    p.unit_cost != null ? p.unit_cost.toFixed(2) : '',
    p.total_cost != null ? p.total_cost.toFixed(2) : ''
  ]);

  // Summary row
  const totalCost = purchases.reduce((sum, p) => sum + (p.total_cost || 0), 0);
  rows.push(['', '', '', '', '', '', '', 'TOTAL', totalCost.toFixed(2)]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const filename = month
    ? 'cogs-report-' + month + '.csv'
    : 'cogs-report-' + (from || 'all') + '-to-' + (to || 'all') + '.csv';

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send(csv);
});

// Get single purchase
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const purchase = db.prepare(`
    SELECT p.*, pr.name as product_name, pr.product_type, pr.unit_of_measure
    FROM purchases p
    JOIN products pr ON pr.id = p.product_id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });
  res.json(purchase);
});

// Update purchase (for cost/vendor corrections)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Purchase not found' });

  const b = req.body;
  const unitCost = b.unit_cost != null ? Number(b.unit_cost) : null;
  const quantity = Number(b.quantity) || existing.quantity;
  const totalCost = (unitCost != null && quantity) ? unitCost * quantity : null;

  db.prepare(`
    UPDATE purchases SET
      quantity = ?, unit_cost = ?, total_cost = ?,
      vendor_name = ?, po_number = ?, purchase_date = ?,
      notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    quantity,
    unitCost,
    totalCost,
    b.vendor_name !== undefined ? b.vendor_name : existing.vendor_name,
    b.po_number !== undefined ? b.po_number : existing.po_number,
    b.purchase_date || existing.purchase_date,
    b.notes !== undefined ? b.notes : existing.notes,
    req.params.id
  );

  logAudit(db, 'purchase', Number(req.params.id), req.session.userId, 'update', {
    before: existing, after: b
  });

  const updated = db.prepare('SELECT * FROM purchases WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
