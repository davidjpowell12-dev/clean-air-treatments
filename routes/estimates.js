const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Helper: get pricing for a sqft value from a service
function getPriceForSqft(db, serviceId, sqft) {
  // Find exact or next-higher tier
  const tier = db.prepare(
    'SELECT price FROM pricing_tiers WHERE service_id = ? AND min_sqft >= ? ORDER BY min_sqft ASC LIMIT 1'
  ).get(serviceId, sqft);
  if (tier) return tier.price;
  // Fallback: highest tier
  const max = db.prepare(
    'SELECT price FROM pricing_tiers WHERE service_id = ? ORDER BY min_sqft DESC LIMIT 1'
  ).get(serviceId);
  return max ? max.price : 0;
}

// List all estimates (with summary)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { status } = req.query;

  let sql = `
    SELECT e.*,
      (SELECT COUNT(*) FROM estimate_items WHERE estimate_id = e.id AND is_included = 1) as item_count
    FROM estimates e
  `;
  const params = [];
  if (status) {
    sql += ' WHERE e.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY e.created_at DESC';

  res.json(db.prepare(sql).all(...params));
});

// Get single estimate with items
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  est.items = db.prepare(
    'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY sort_order, id'
  ).all(est.id);

  res.json(est);
});

// Build estimate for a property — returns services with auto-priced items
router.get('/build/:propertyId', requireAuth, (req, res) => {
  const db = getDb();
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const services = db.prepare(
    'SELECT * FROM services WHERE is_active = 1 ORDER BY display_order, id'
  ).all();

  const sqft = prop.sqft || 0;
  const items = services.map((svc, i) => ({
    service_id: svc.id,
    service_name: svc.name,
    description: svc.description,
    is_recurring: svc.is_recurring,
    rounds: svc.rounds,
    price: sqft > 0 ? getPriceForSqft(db, svc.id, sqft) : 0,
    is_included: 1,
    sort_order: i
  }));

  res.json({
    property: prop,
    items
  });
});

// Create estimate
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const {
    property_id, customer_name, address, city, state, zip,
    email, phone, property_sqft, payment_months,
    valid_until, notes, customer_message, items
  } = req.body;

  if (!customer_name) return res.status(400).json({ error: 'Customer name required' });
  if (!items || !items.length) return res.status(400).json({ error: 'At least one item required' });

  const months = payment_months || 8;

  const create = db.transaction(() => {
    // Calculate totals from included items
    const includedItems = items.filter(i => i.is_included);
    const totalPrice = includedItems.reduce((sum, i) => {
      return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
    }, 0);
    const monthlyPrice = Math.round((totalPrice / months) * 100) / 100;

    const result = db.prepare(`
      INSERT INTO estimates (
        property_id, customer_name, address, city, state, zip,
        email, phone, property_sqft, total_price, monthly_price,
        payment_months, valid_until, notes, customer_message, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      property_id || null, customer_name, address, city, state || 'MI', zip,
      email, phone, property_sqft, totalPrice, monthlyPrice,
      months, valid_until || null, notes || null, customer_message || null,
      req.session.userId
    );

    const estId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO estimate_items (
        estimate_id, service_id, service_name, description, price,
        is_recurring, rounds, is_included, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(
        estId, item.service_id || null, item.service_name, item.description || null,
        item.price, item.is_recurring ? 1 : 0, item.rounds || 1,
        item.is_included ? 1 : 0, item.sort_order || 0
      );
    }

    return estId;
  });

  const estId = create();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estId);
  est.items = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ?').all(estId);

  logAudit(db, 'estimate', estId, req.session.userId, 'create', {
    customer_name, total: est.total_price, items: items.length
  });

  res.json(est);
});

// Update estimate (items, prices, toggles, customer info)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Estimate not found' });

  const {
    customer_name, address, city, state, zip, email, phone,
    property_sqft, payment_months, valid_until, notes,
    customer_message, status, items
  } = req.body;

  const months = payment_months || existing.payment_months;

  const update = db.transaction(() => {
    // If items provided, recalculate totals and replace items
    let totalPrice = existing.total_price;
    let monthlyPrice = existing.monthly_price;

    if (items) {
      // Delete existing items and re-insert
      db.prepare('DELETE FROM estimate_items WHERE estimate_id = ?').run(req.params.id);

      const insertItem = db.prepare(`
        INSERT INTO estimate_items (
          estimate_id, service_id, service_name, description, price,
          is_recurring, rounds, is_included, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        insertItem.run(
          req.params.id, item.service_id || null, item.service_name,
          item.description || null, item.price,
          item.is_recurring ? 1 : 0, item.rounds || 1,
          item.is_included ? 1 : 0, item.sort_order || 0
        );
      }

      const included = items.filter(i => i.is_included);
      totalPrice = included.reduce((sum, i) => {
        return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
      }, 0);
      monthlyPrice = Math.round((totalPrice / months) * 100) / 100;
    }

    db.prepare(`
      UPDATE estimates SET
        customer_name = COALESCE(?, customer_name),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        zip = COALESCE(?, zip),
        email = ?,
        phone = ?,
        property_sqft = COALESCE(?, property_sqft),
        total_price = ?,
        monthly_price = ?,
        payment_months = ?,
        valid_until = ?,
        notes = ?,
        customer_message = ?,
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      customer_name || null, address || null, city || null, state || null, zip || null,
      email !== undefined ? email : existing.email,
      phone !== undefined ? phone : existing.phone,
      property_sqft || null, totalPrice, monthlyPrice, months,
      valid_until !== undefined ? valid_until : existing.valid_until,
      notes !== undefined ? notes : existing.notes,
      customer_message !== undefined ? customer_message : existing.customer_message,
      status || null, req.params.id
    );
  });

  update();

  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  est.items = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY sort_order, id').all(req.params.id);

  logAudit(db, 'estimate', req.params.id, req.session.userId, 'update', {
    status: est.status, total: est.total_price
  });

  res.json(est);
});

// Toggle a single item's included status
router.put('/:id/items/:itemId/toggle', requireAuth, (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM estimate_items WHERE id = ? AND estimate_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const newIncluded = item.is_included ? 0 : 1;
  db.prepare('UPDATE estimate_items SET is_included = ? WHERE id = ?').run(newIncluded, item.id);

  // Recalculate totals
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  const allItems = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ?').all(req.params.id);
  const included = allItems.filter(i => i.is_included);
  const totalPrice = included.reduce((sum, i) => {
    return sum + (i.is_recurring ? i.price * i.rounds : i.price);
  }, 0);
  const monthlyPrice = Math.round((totalPrice / est.payment_months) * 100) / 100;

  db.prepare('UPDATE estimates SET total_price = ?, monthly_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(totalPrice, monthlyPrice, req.params.id);

  res.json({ is_included: newIncluded, total_price: totalPrice, monthly_price: monthlyPrice });
});

// Delete estimate
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Estimate not found' });

  db.prepare('DELETE FROM estimates WHERE id = ?').run(req.params.id);
  logAudit(db, 'estimate', req.params.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// Update estimate status (send, mark viewed, accept, decline)
router.put('/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const { status } = req.body;
  const validStatuses = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  const timestamps = {};
  if (status === 'sent') timestamps.sent_at = new Date().toISOString();
  if (status === 'viewed') timestamps.viewed_at = new Date().toISOString();
  if (status === 'accepted') timestamps.accepted_at = new Date().toISOString();
  if (status === 'declined') timestamps.declined_at = new Date().toISOString();

  let sql = 'UPDATE estimates SET status = ?, updated_at = CURRENT_TIMESTAMP';
  const params = [status];

  for (const [col, val] of Object.entries(timestamps)) {
    sql += `, ${col} = ?`;
    params.push(val);
  }

  sql += ' WHERE id = ?';
  params.push(req.params.id);
  db.prepare(sql).run(...params);

  logAudit(db, 'estimate', req.params.id, req.session.userId, 'status_change', {
    from: est.status, to: status
  });

  const updated = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Get estimates that need reminders (sent > 24h ago, no response, under max reminders)
router.get('/reminders/pending', requireAuth, (req, res) => {
  const db = getDb();
  const estimates = db.prepare(`
    SELECT e.*,
      COALESCE(e.last_reminder_at, e.sent_at) as last_contact_at
    FROM estimates e
    WHERE e.status = 'sent'
      AND e.reminder_count < e.max_reminders
      AND (
        (e.last_reminder_at IS NULL AND e.sent_at <= datetime('now', '-1 day'))
        OR (e.last_reminder_at IS NOT NULL AND e.last_reminder_at <= datetime('now', '-1 day'))
      )
    ORDER BY e.sent_at ASC
  `).all();

  res.json(estimates);
});

// Mark a reminder as sent for an estimate
router.post('/:id/reminder-sent', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  db.prepare(`
    UPDATE estimates SET
      last_reminder_at = CURRENT_TIMESTAMP,
      reminder_count = reminder_count + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  logAudit(db, 'estimate', req.params.id, req.session.userId, 'reminder_sent', {
    reminder_number: est.reminder_count + 1
  });

  const updated = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
