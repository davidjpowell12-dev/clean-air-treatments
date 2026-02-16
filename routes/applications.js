const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List applications
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { from, to, limit, property_id } = req.query;

  let sql = `
    SELECT a.*, u.full_name as applicator_name, pr.customer_name as property_customer_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.applicator_id
    LEFT JOIN properties pr ON pr.id = a.property_id
  `;
  const params = [];
  const conditions = [];

  if (from) { conditions.push('a.application_date >= ?'); params.push(from); }
  if (to) { conditions.push('a.application_date <= ?'); params.push(to); }
  if (property_id) { conditions.push('a.property_id = ?'); params.push(Number(property_id)); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY a.application_date DESC, a.created_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }

  res.json(db.prepare(sql).all(...params));
});

// Export CSV for MDARD reporting (must be before /:id)
router.get('/export', requireAuth, (req, res) => {
  const db = getDb();
  const { from, to } = req.query;

  let sql = `
    SELECT a.*, u.full_name as applicator_name, pr.customer_name as property_customer_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.applicator_id
    LEFT JOIN properties pr ON pr.id = a.property_id
  `;
  const params = [];
  const conditions = [];

  if (from) { conditions.push('a.application_date >= ?'); params.push(from); }
  if (to) { conditions.push('a.application_date <= ?'); params.push(to); }

  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY a.application_date ASC';

  const apps = db.prepare(sql).all(...params);

  const headers = [
    'Date', 'Start Time', 'End Time',
    'Applicator', 'Cert Number',
    'Customer', 'Address', 'City', 'State', 'Zip',
    'Property Sqft', 'Area Treated Sqft',
    'Product Name', 'EPA Reg Number', 'Restricted Use',
    'Rate Applied', 'Rate Unit', 'Total Product Used',
    'Dilution Rate', 'Total Mix Volume (gal)',
    'Application Method', 'Target Pest',
    'Temperature F', 'Wind Speed MPH', 'Wind Direction', 'Weather',
    'Lawn Markers Posted', 'Registry Checked',
    'Retention Years', 'Notes'
  ];

  const rows = apps.map(a => [
    a.application_date, a.start_time || '', a.end_time || '',
    a.applicator_name || '', a.applicator_cert_number || '',
    a.customer_name || '', a.address, a.city || '', a.state || '', a.zip || '',
    a.property_sqft || '', a.total_area_treated || '',
    a.product_name, a.epa_reg_number || '', a.is_restricted_use ? 'Yes' : 'No',
    a.app_rate_used, a.app_rate_unit, a.total_product_used,
    a.dilution_rate || '', a.total_mix_volume || '',
    a.application_method || '', a.target_pest || '',
    a.temperature_f || '', a.wind_speed_mph || '', a.wind_direction || '', a.weather_conditions || '',
    a.lawn_markers_posted ? 'Yes' : 'No', a.notification_registry_checked ? 'Yes' : 'No',
    a.retention_years || 3, a.notes || ''
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="applications-export.csv"');
  res.send(csv);
});

// Get single application
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const app = db.prepare(`
    SELECT a.*, u.full_name as applicator_name, pr.customer_name as property_customer_name
    FROM applications a
    LEFT JOIN users u ON u.id = a.applicator_id
    LEFT JOIN properties pr ON pr.id = a.property_id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!app) return res.status(404).json({ error: 'Application not found' });
  res.json(app);
});

// Create application
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const b = req.body;

  const retentionYears = (b.is_restricted_use == 1 || b.is_restricted_use === true) ? 7 : 3;

  const result = db.prepare(`
    INSERT INTO applications (
      applicator_id, applicator_cert_number,
      application_date, start_time, end_time,
      customer_name, address, city, state, zip, property_sqft,
      product_id, product_name, epa_reg_number,
      app_rate_used, app_rate_unit, total_product_used, total_area_treated,
      dilution_rate, total_mix_volume,
      application_method, target_pest,
      temperature_f, wind_speed_mph, wind_direction, weather_conditions,
      lawn_markers_posted, notification_registry_checked, is_restricted_use,
      notes, property_id, retention_years
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    req.session.userId,
    b.applicator_cert_number || req.session.applicatorCertNumber || null,
    b.application_date,
    b.start_time || null, b.end_time || null,
    b.customer_name || null, b.address, b.city || null, b.state || 'MI', b.zip || null, b.property_sqft || null,
    b.product_id, b.product_name, b.epa_reg_number || null,
    b.app_rate_used, b.app_rate_unit, b.total_product_used, b.total_area_treated,
    b.dilution_rate || null, b.total_mix_volume || null,
    b.application_method || null, b.target_pest || null,
    b.temperature_f || null, b.wind_speed_mph || null, b.wind_direction || null, b.weather_conditions || null,
    b.lawn_markers_posted || 0, b.notification_registry_checked || 0, b.is_restricted_use || 0,
    b.notes || null,
    b.property_id || null,
    retentionYears
  );

  // Auto-deduct inventory
  if (b.product_id && b.total_product_used) {
    const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(b.product_id);
    if (inv) {
      const newQty = inv.quantity - Number(b.total_product_used);
      db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
        .run(newQty, b.product_id);
      db.prepare(
        'INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)'
      ).run(b.product_id, -Number(b.total_product_used), 'application', result.lastInsertRowid, req.session.userId);
    }
  }

  logAudit(db, 'application', result.lastInsertRowid, req.session.userId, 'create', b);
  res.json({ id: result.lastInsertRowid });
});

// Update application (rejected if synced)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);

  if (!existing) return res.status(404).json({ error: 'Application not found' });

  // Immutable after sync — cannot edit synced records
  if (existing.synced === 1) {
    return res.status(403).json({ error: 'Cannot edit synced application records. Records are locked for compliance.' });
  }

  const b = req.body;

  db.prepare(`
    UPDATE applications SET
      application_date = ?, start_time = ?, end_time = ?,
      customer_name = ?, address = ?, city = ?, state = ?, zip = ?, property_sqft = ?,
      product_id = ?, product_name = ?, epa_reg_number = ?,
      app_rate_used = ?, app_rate_unit = ?, total_product_used = ?, total_area_treated = ?,
      dilution_rate = ?, total_mix_volume = ?,
      application_method = ?, target_pest = ?,
      temperature_f = ?, wind_speed_mph = ?, wind_direction = ?, weather_conditions = ?,
      lawn_markers_posted = ?, notification_registry_checked = ?, is_restricted_use = ?,
      notes = ?, property_id = ?
    WHERE id = ?
  `).run(
    b.application_date, b.start_time || null, b.end_time || null,
    b.customer_name || null, b.address, b.city || null, b.state || 'MI', b.zip || null, b.property_sqft || null,
    b.product_id, b.product_name, b.epa_reg_number || null,
    b.app_rate_used, b.app_rate_unit, b.total_product_used, b.total_area_treated,
    b.dilution_rate || null, b.total_mix_volume || null,
    b.application_method || null, b.target_pest || null,
    b.temperature_f || null, b.wind_speed_mph || null, b.wind_direction || null, b.weather_conditions || null,
    b.lawn_markers_posted || 0, b.notification_registry_checked || 0, b.is_restricted_use || 0,
    b.notes || null, b.property_id || null,
    req.params.id
  );

  logAudit(db, 'application', Number(req.params.id), req.session.userId, 'update', { before: existing, after: b });
  res.json({ success: true });
});

// Sync offline records
router.post('/sync', requireAuth, (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'Records array required' });

  const db = getDb();
  const synced = [];

  for (const b of records) {
    try {
      const retentionYears = (b.is_restricted_use == 1) ? 7 : 3;
      const result = db.prepare(`
        INSERT INTO applications (
          applicator_id, applicator_cert_number,
          application_date, start_time, end_time,
          customer_name, address, city, state, zip, property_sqft,
          product_id, product_name, epa_reg_number,
          app_rate_used, app_rate_unit, total_product_used, total_area_treated,
          dilution_rate, total_mix_volume,
          application_method, target_pest,
          temperature_f, wind_speed_mph, wind_direction, weather_conditions,
          lawn_markers_posted, notification_registry_checked, is_restricted_use,
          notes, property_id, retention_years
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.session.userId, b.applicator_cert_number || null,
        b.application_date, b.start_time || null, b.end_time || null,
        b.customer_name || null, b.address, b.city || null, b.state || 'MI', b.zip || null, b.property_sqft || null,
        b.product_id, b.product_name, b.epa_reg_number || null,
        b.app_rate_used, b.app_rate_unit, b.total_product_used, b.total_area_treated,
        b.dilution_rate || null, b.total_mix_volume || null,
        b.application_method || null, b.target_pest || null,
        b.temperature_f || null, b.wind_speed_mph || null, b.wind_direction || null, b.weather_conditions || null,
        b.lawn_markers_posted || 0, b.notification_registry_checked || 0, b.is_restricted_use || 0,
        b.notes || null, b.property_id || null, retentionYears
      );
      logAudit(db, 'application', result.lastInsertRowid, req.session.userId, 'sync_create', b);
      synced.push(result.lastInsertRowid);
    } catch (e) {
      console.error('Sync error for record:', e.message);
    }
  }

  res.json({ synced: synced.length, ids: synced });
});

module.exports = router;
