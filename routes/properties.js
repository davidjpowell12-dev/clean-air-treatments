const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// List properties (with search). By default returns only active (un-archived)
// properties; pass ?include_inactive=1 to get archived ones too.
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { search, limit, include_inactive } = req.query;

  let sql = 'SELECT * FROM properties';
  const where = [];
  const params = [];

  if (!include_inactive || include_inactive === '0') {
    where.push('COALESCE(is_active, 1) = 1');
  }

  if (search) {
    where.push('(customer_name LIKE ? OR address LIKE ? OR city LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY customer_name';

  if (limit) {
    sql += ' LIMIT ?';
    params.push(Number(limit));
  }

  res.json(db.prepare(sql).all(...params));
});

// Archive / restore a property. Soft-delete only — keeps all history intact.
router.put('/:id/active', requireAuth, (req, res) => {
  const db = getDb();
  const { is_active } = req.body;
  const val = is_active ? 1 : 0;
  const result = db.prepare('UPDATE properties SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(val, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Property not found' });
  logAudit(db, 'property', req.params.id, req.session.userId, val ? 'restored' : 'archived', {});
  res.json({ success: true, is_active: val });
});

// Migration tracker: one row per property with estimate + invoice status.
// Built so the user can power through onboarding/migration and see at a glance
// which properties still need an estimate or an invoice.
router.get('/migration-status', requireAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      p.id,
      p.customer_name,
      p.address,
      p.city,
      p.phone,
      p.email,
      (SELECT e.status FROM estimates e WHERE e.property_id = p.id
       ORDER BY CASE e.status
         WHEN 'accepted' THEN 1
         WHEN 'sent' THEN 2
         WHEN 'draft' THEN 3
         ELSE 4 END,
         e.id DESC LIMIT 1) as estimate_status,
      (SELECT e.id FROM estimates e WHERE e.property_id = p.id
       ORDER BY CASE e.status
         WHEN 'accepted' THEN 1
         WHEN 'sent' THEN 2
         WHEN 'draft' THEN 3
         ELSE 4 END,
         e.id DESC LIMIT 1) as estimate_id,
      (SELECT COUNT(*) FROM invoices i
       JOIN estimates e ON e.id = i.estimate_id
       WHERE e.property_id = p.id) as invoice_count,
      (SELECT COUNT(*) FROM invoices i
       JOIN estimates e ON e.id = i.estimate_id
       WHERE e.property_id = p.id AND i.status NOT IN ('paid','void','cancelled')) as unpaid_count,
      (SELECT COUNT(*) FROM invoices i
       JOIN estimates e ON e.id = i.estimate_id
       WHERE e.property_id = p.id AND i.status = 'paid') as paid_count
    FROM properties p
    WHERE COALESCE(p.is_active, 1) = 1
    ORDER BY p.customer_name COLLATE NOCASE, p.address COLLATE NOCASE
  `).all();

  const total = rows.length;
  const estimateAccepted = rows.filter(r => r.estimate_status === 'accepted').length;
  const hasInvoice = rows.filter(r => r.invoice_count > 0).length;
  const fullySetup = rows.filter(r => r.estimate_status === 'accepted' && r.invoice_count > 0).length;
  const noEstimate = rows.filter(r => !r.estimate_status).length;

  res.json({
    rows,
    summary: {
      total,
      estimate_accepted: estimateAccepted,
      has_invoice: hasInvoice,
      fully_setup: fullySetup,
      no_estimate: noEstimate
    }
  });
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

// 360° customer overview — property basics + estimates + invoices + stats.
// Built to back the CRM-style property detail page so everything about one
// customer is visible in one place without extra round trips.
router.get('/:id/overview', requireAuth, (req, res) => {
  const db = getDb();
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  // Same baseline fields the /:id endpoint returns (so the frontend can
  // swap fetches with no detail-page regression)
  const appCount = db.prepare('SELECT COUNT(*) as count FROM applications WHERE property_id = ?').get(req.params.id);
  const ipmCount = db.prepare("SELECT COUNT(*) as count FROM ipm_cases WHERE property_id = ? AND status != 'resolved'").get(req.params.id);
  const lastApp = db.prepare('SELECT application_date FROM applications WHERE property_id = ? ORDER BY application_date DESC LIMIT 1').get(req.params.id);
  prop.application_count = appCount.count;
  prop.active_ipm_cases = ipmCount.count;
  prop.last_application_date = lastApp ? lastApp.application_date : null;
  prop.zones = db.prepare('SELECT * FROM property_zones WHERE property_id = ? ORDER BY sort_order, id').all(req.params.id);
  const profitability = db.prepare(`
    SELECT
      COALESCE(SUM(revenue), 0) as total_revenue,
      COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0) as total_cost,
      COALESCE(SUM(revenue), 0) - (COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0)) as total_margin,
      CASE WHEN COALESCE(SUM(revenue), 0) > 0
        THEN ROUND(((COALESCE(SUM(revenue), 0) - (COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0))) / COALESCE(SUM(revenue), 0)) * 100, 1)
        ELSE 0
      END as margin_pct
    FROM applications WHERE property_id = ?
  `).get(req.params.id);
  prop.profitability = profitability;

  // Estimates for this property — most recent first. Include a short summary
  // of included services so the list is scannable without drilling in.
  const estimates = db.prepare(`
    SELECT id, status, total_price, monthly_price, payment_plan,
           payment_method_preference, payment_months,
           accepted_at, sent_at, declined_at, valid_until, created_at, updated_at
    FROM estimates
    WHERE property_id = ?
    ORDER BY COALESCE(accepted_at, created_at) DESC, id DESC
  `).all(req.params.id);
  for (const e of estimates) {
    const items = db.prepare(`
      SELECT service_name, is_recurring, rounds, is_included
      FROM estimate_items WHERE estimate_id = ? AND is_included = 1
      ORDER BY sort_order, id
    `).all(e.id);
    // Short human-readable summary: "Fert & Weed · Mowing · Mosquito & Tick"
    e.services_summary = items
      .filter(i => i.service_name !== 'Bundle Discount')
      .map(i => i.service_name)
      .join(' · ');
    e.item_count = items.length;
  }

  // Invoices for this property — joined through estimates. Group by estimate
  // so the frontend can show "Monthly · 2 of 8 paid" style summaries.
  const invoices = db.prepare(`
    SELECT i.id, i.invoice_number, i.estimate_id, i.amount_cents, i.status,
           i.payment_plan, i.installment_number, i.total_installments,
           i.due_date, i.paid_at, i.payment_method, i.check_number,
           i.token, i.notes
    FROM invoices i
    JOIN estimates e ON e.id = i.estimate_id
    WHERE e.property_id = ?
    ORDER BY i.due_date ASC, COALESCE(i.installment_number, 0) ASC, i.id ASC
  `).all(req.params.id);

  // Top-of-page summary stats: the "is this customer healthy?" quick read.
  const acceptedEst = estimates.find(e => e.status === 'accepted') || null;
  const today = new Date().toISOString().slice(0, 10);
  let outstandingCents = 0, paidCents = 0;
  for (const inv of invoices) {
    if (inv.status === 'paid') paidCents += inv.amount_cents || 0;
    else if (inv.status !== 'void') outstandingCents += inv.amount_cents || 0;
  }
  const nextVisit = db.prepare(`
    SELECT scheduled_date, service_type FROM schedules
    WHERE property_id = ? AND status != 'completed' AND status != 'cancelled'
      AND scheduled_date >= ?
    ORDER BY scheduled_date ASC LIMIT 1
  `).get(req.params.id, today);

  prop.overview_stats = {
    season_total: acceptedEst ? acceptedEst.total_price : 0,
    outstanding: outstandingCents / 100,
    paid: paidCents / 100,
    last_visit_date: prop.last_application_date,
    next_visit_date: nextVisit ? nextVisit.scheduled_date : null,
    next_visit_service: nextVisit ? nextVisit.service_type : null,
    payment_plan: acceptedEst ? acceptedEst.payment_plan : null,
    payment_method: acceptedEst ? acceptedEst.payment_method_preference : null
  };

  res.json({ property: prop, estimates, invoices });
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
  const { customer_name, address, city, state, zip, email, phone, sqft, soil_type, notes } = req.body;

  if (!customer_name || !address) {
    return res.status(400).json({ error: 'Customer name and address are required' });
  }

  const result = db.prepare(`
    INSERT INTO properties (customer_name, address, city, state, zip, email, phone, sqft, soil_type, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customer_name, address, city || null, state || 'MI', zip || null, email || null, phone || null, sqft || null, soil_type || null, notes || null);

  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'property', prop.id, req.session.userId, 'create', prop);
  res.json(prop);
});

// Update property
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found' });

  const { customer_name, address, city, state, zip, email, phone, sqft, soil_type, notes } = req.body;

  db.prepare(`
    UPDATE properties SET
      customer_name = COALESCE(?, customer_name),
      address = COALESCE(?, address),
      city = ?, state = ?, zip = ?, email = ?, phone = ?, sqft = ?, soil_type = ?, notes = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    customer_name || null, address || null,
    city !== undefined ? city : existing.city,
    state || existing.state,
    zip !== undefined ? zip : existing.zip,
    email !== undefined ? email : existing.email,
    phone !== undefined ? phone : existing.phone,
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

// CRM Import — bulk create properties + optionally generate schedules
router.post('/import', requireAdmin, (req, res) => {
  // Support both old format { properties: [...] } and new CRM format { clients: [...] }
  const clients = req.body.clients || req.body.properties;
  const createSchedules = req.body.create_schedules || false;

  if (!Array.isArray(clients)) {
    return res.status(400).json({ error: 'clients or properties array required' });
  }

  const db = getDb();
  const insertProp = db.prepare(`
    INSERT INTO properties (customer_name, address, city, state, zip, email, phone, sqft)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const existingAddresses = new Set(
    db.prepare('SELECT LOWER(address) as addr FROM properties').all().map(r => r.addr)
  );

  const importAll = db.transaction(() => {
    let propertiesCreated = 0;
    let schedulesCreated = 0;
    let skipped = 0;

    for (const c of clients) {
      if (!c.customer_name || !c.address) { skipped++; continue; }

      const addrLower = c.address.trim().toLowerCase();
      let propertyId;

      if (existingAddresses.has(addrLower)) {
        // Get existing property ID for schedule creation
        const existing = db.prepare('SELECT id FROM properties WHERE LOWER(address) = ?').get(addrLower);
        if (existing) propertyId = existing.id;
        skipped++;
      } else {
        try {
          const result = insertProp.run(
            c.customer_name, c.address, c.city || null, c.state || 'MI',
            c.zip || null, c.email || null, c.phone || null,
            c.sqft ? Number(c.sqft) : null
          );
          propertyId = result.lastInsertRowid;
          existingAddresses.add(addrLower);
          propertiesCreated++;
        } catch (e) { continue; }
      }

      // Create schedule if requested and we have a start_date
      if (createSchedules && propertyId && c.start_date) {
        const rounds = parseInt(c.rounds) || 6;
        const interval = parseInt(c.interval_weeks) || 5;
        const programId = `crm_${propertyId}_${Date.now()}`;

        for (let round = 1; round <= rounds; round++) {
          const offsetDays = (round - 1) * interval * 7;
          const roundDate = db.prepare("SELECT date(?, '+' || ? || ' days') as d").get(c.start_date, offsetDays);
          db.prepare(`
            INSERT INTO schedules (property_id, scheduled_date, sort_order, round_number, total_rounds, program_id, created_by)
            VALUES (?, ?, 0, ?, ?, ?, ?)
          `).run(propertyId, roundDate.d, round, rounds, programId, req.session.userId);
          schedulesCreated++;
        }
      }
    }

    return { properties_created: propertiesCreated, schedules_created: schedulesCreated, skipped };
  });

  const result = importAll();
  logAudit(db, 'properties', 0, req.session.userId, 'crm_import', result);
  res.json(result);
});

module.exports = router;
