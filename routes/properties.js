const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List properties (with search)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { search, limit } = req.query;

  let sql = 'SELECT * FROM properties';
  const params = [];

  if (search) {
    sql += ' WHERE customer_name LIKE ? OR address LIKE ? OR city LIKE ?';
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  sql += ' ORDER BY customer_name';

  if (limit) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
  }

  res.json(db.prepare(sql).all(...params));
});

// Get single property with stats
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const appCount = db.prepare('SELECT COUNT(*) as count FROM applications WHERE property_id = ?').get(req.params.id);
  const ipmCount = db.prepare("SELECT COUNT(*) as count FROM ipm_cases WHERE property_id = ? AND status != 'resolved'").get(req.params.id);
  const lastApp = db.prepare('SELECT application_date FROM applications WHERE property_id = ? ORDER BY application_date DESC LIMIT 1').get(req.params.id);

  prop.application_count = appCount.count;
  prop.active_ipm_cases = ipmCount.count;
  prop.last_application_date = lastApp ? lastApp.application_date : null;

  // Include yard zones
  prop.zones = db.prepare('SELECT * FROM property_zones WHERE property_id = ? ORDER BY sort_order, id').all(req.params.id);

  // Profitability summary across all visits
  const profitability = db.prepare(`
    SELECT
      COALESCE(SUM(revenue), 0) as total_revenue,
      COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0) as total_cost,
      COALESCE(SUM(revenue), 0) - (COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0)) as total_margin,
      CASE WHEN COALESCE(SUM(revenue), 0) > 0
        THEN ROUND(((COALESCE(SUM(revenue), 0) - (COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0))) / COALESCE(SUM(revenue), 0)) * 100, 1)
        ELSE 0
      END as margin_pct
    FROM applications
    WHERE property_id = ?
  `).get(req.params.id);
  prop.profitability = profitability;

  res.json(prop);
});

// Get applications for a property
router.get('/:id/applications', requireAuth, (req, res) => {
  const db = getDb();
  const applications = db.prepare(`
    SELECT a.*, u.full_name as applicator_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.applicator_id
    WHERE a.property_id = ?
    ORDER BY a.application_date DESC, a.created_at DESC
  `).all(req.params.id);
  res.json(applications);
});

// Get IPM cases for a property
router.get('/:id/ipm-cases', requireAuth, (req, res) => {
  const db = getDb();
  const cases = db.prepare(`
    SELECT ic.*, u.full_name as created_by_name,
           (SELECT COUNT(*) FROM ipm_observations WHERE case_id = ic.id) as observation_count
    FROM ipm_cases ic
    LEFT JOIN users u ON u.id = ic.created_by
    WHERE ic.property_id = ?
    ORDER BY ic.created_at DESC
  `).all(req.params.id);
  res.json(cases);
});

// Create property
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { customer_name, address, city, state, zip, sqft, soil_type, notes } = req.body;

  if (!customer_name || !address) {
    return res.status(400).json({ error: 'Customer name and address are required' });
  }

  const result = db.prepare(`
    INSERT INTO properties (customer_name, address, city, state, zip, sqft, soil_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customer_name, address, city || null, state || 'MI', zip || null, sqft || null, soil_type || null, notes || null);

  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'property', prop.id, req.session.userId, 'create', prop);
  res.json(prop);
});

// Update property
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found' });

  const { customer_name, address, city, state, zip, sqft, soil_type, notes } = req.body;

  db.prepare(`
    UPDATE properties SET
      customer_name = COALESCE(?, customer_name),
      address = COALESCE(?, address),
      city = ?, state = ?, zip = ?, sqft = ?, soil_type = ?, notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    customer_name || null, address || null,
    city !== undefined ? city : existing.city,
    state || existing.state,
    zip !== undefined ? zip : existing.zip,
    sqft !== undefined ? sqft : existing.sqft,
    soil_type !== undefined ? soil_type : existing.soil_type,
    notes !== undefined ? notes : existing.notes,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  logAudit(db, 'property', updated.id, req.session.userId, 'update', { before: existing, after: updated });
  res.json(updated);
});

// Delete property (admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found' });

  // Don't delete if applications are linked
  const appCount = db.prepare('SELECT COUNT(*) as count FROM applications WHERE property_id = ?').get(req.params.id);
  if (appCount.count > 0) {
    return res.status(400).json({ error: `Cannot delete property with ${appCount.count} linked application(s)` });
  }

  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  logAudit(db, 'property', req.params.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// --- Property Zones ---

// Helper: recalculate property sqft from zone totals
function syncPropertySqft(db, propertyId) {
  const sum = db.prepare('SELECT COALESCE(SUM(sqft), 0) as total FROM property_zones WHERE property_id = ?').get(propertyId);
  if (sum.total > 0) {
    db.prepare('UPDATE properties SET sqft = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sum.total, propertyId);
  }
  return sum.total;
}

// List zones for a property
router.get('/:id/zones', requireAuth, (req, res) => {
  const db = getDb();
  const zones = db.prepare('SELECT * FROM property_zones WHERE property_id = ? ORDER BY sort_order, id').all(req.params.id);
  res.json(zones);
});

// Add a zone
router.post('/:id/zones', requireAuth, (req, res) => {
  const db = getDb();
  const prop = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const { zone_name, sqft } = req.body;
  if (!zone_name || !sqft) return res.status(400).json({ error: 'Zone name and square footage required' });

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as max FROM property_zones WHERE property_id = ?').get(req.params.id);
  const result = db.prepare('INSERT INTO property_zones (property_id, zone_name, sqft, sort_order) VALUES (?, ?, ?, ?)')
    .run(req.params.id, zone_name, Number(sqft), maxOrder.max + 1);

  const total = syncPropertySqft(db, req.params.id);
  const zone = db.prepare('SELECT * FROM property_zones WHERE id = ?').get(result.lastInsertRowid);
  res.json({ zone, total_sqft: total });
});

// Update a zone
router.put('/:id/zones/:zoneId', requireAuth, (req, res) => {
  const db = getDb();
  const zone = db.prepare('SELECT * FROM property_zones WHERE id = ? AND property_id = ?').get(req.params.zoneId, req.params.id);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

  const { zone_name, sqft } = req.body;
  db.prepare('UPDATE property_zones SET zone_name = COALESCE(?, zone_name), sqft = COALESCE(?, sqft) WHERE id = ?')
    .run(zone_name || null, sqft != null ? Number(sqft) : null, req.params.zoneId);

  const total = syncPropertySqft(db, req.params.id);
  const updated = db.prepare('SELECT * FROM property_zones WHERE id = ?').get(req.params.zoneId);
  res.json({ zone: updated, total_sqft: total });
});

// Delete a zone
router.delete('/:id/zones/:zoneId', requireAuth, (req, res) => {
  const db = getDb();
  const zone = db.prepare('SELECT * FROM property_zones WHERE id = ? AND property_id = ?').get(req.params.zoneId, req.params.id);
  if (!zone) return res.status(404).json({ error: 'Zone not found' });

  db.prepare('DELETE FROM property_zones WHERE id = ?').run(req.params.zoneId);
  const total = syncPropertySqft(db, req.params.id);
  res.json({ success: true, total_sqft: total });
});

// Bulk import properties (admin only)
router.post('/import', requireAdmin, (req, res) => {
  const { properties } = req.body;
  if (!Array.isArray(properties)) {
    return res.status(400).json({ error: 'Properties array required' });
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO properties (customer_name, address, city, state, zip, sqft, soil_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const importMany = db.transaction((props) => {
    let imported = 0;
    const errors = [];
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (!p.customer_name || !p.address) {
        errors.push(`Row ${i + 1}: Missing customer_name or address`);
        continue;
      }
      try {
        stmt.run(
          p.customer_name, p.address, p.city || null, p.state || 'MI',
          p.zip || null, p.sqft ? Number(p.sqft) : null, p.soil_type || null, p.notes || null
        );
        imported++;
      } catch (e) {
        errors.push(`Row ${i + 1}: ${e.message}`);
      }
    }
    return { imported, errors };
  });

  const result = importMany(properties);
  logAudit(db, 'properties', 0, req.session.userId, 'bulk_import', { count: result.imported });
  res.json(result);
});

module.exports = router;
