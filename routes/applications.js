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

// YTD financial stats for dashboard (must be before /:id)
router.get('/stats', requireAuth, (req, res) => {
  const db = getDb();
  const year = req.query.year || new Date().getFullYear();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(revenue), 0) as total_revenue,
      COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0) as total_cost,
      COALESCE(SUM(revenue), 0) - (COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0)) as total_margin,
      CASE WHEN COALESCE(SUM(revenue), 0) > 0
        THEN ROUND(((COALESCE(SUM(revenue), 0) - (COALESCE(SUM(labor_cost), 0) + COALESCE(SUM(material_cost), 0))) / COALESCE(SUM(revenue), 0)) * 100, 1)
        ELSE 0
      END as margin_pct,
      COUNT(*) as total_applications
    FROM applications
    WHERE application_date BETWEEN ? AND ?
  `).get(startDate, endDate);

  res.json(stats);
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
      notes, property_id, retention_years,
      duration_minutes, labor_cost, material_cost, revenue,
      schedule_id
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    retentionYears,
    b.duration_minutes || null, b.labor_cost || null, b.material_cost || null, b.revenue || null,
    b.schedule_id || null
  );

  // Auto-complete the linked schedule entry
  if (b.schedule_id) {
    db.prepare(
      "UPDATE schedules SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'completed'"
    ).run(b.schedule_id);

    // ─── Billing: activate monthly invoices OR create per-service invoice ───
    try {
      const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(b.schedule_id);
      if (schedule && schedule.estimate_id) {
        const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(schedule.estimate_id);

        if (estimate && estimate.payment_plan === 'monthly') {
          // Monthly plan: activate scheduled invoices on first visit
          const { activateBillingForEstimate } = require('../utils/billing');
          activateBillingForEstimate(db, schedule.estimate_id);

        } else if (estimate && estimate.payment_plan === 'per_service') {
          // Per-service plan: create an invoice for this completed visit
          const { createPerServiceInvoice } = require('../utils/stripe');
          const serviceType = schedule.service_type || 'Service';

          // Look up the price from estimate items
          const item = db.prepare(
            "SELECT * FROM estimate_items WHERE estimate_id = ? AND service_name = ? AND is_included = 1"
          ).get(schedule.estimate_id, serviceType);

          if (item) {
            // For recurring items, price is per-round; for one-time, it's the full price
            const amountCents = Math.round(item.price * 100);
            const roundInfo = schedule.round_number ? ` (Round ${schedule.round_number}/${schedule.total_rounds})` : '';
            const description = `${serviceType}${roundInfo} — ${estimate.customer_name}`;

            const invoice = createPerServiceInvoice(db, schedule.estimate_id, amountCents, description);
            console.log(`[per-service] Invoice ${invoice.invoice_number} created: $${(amountCents / 100).toFixed(2)} for ${description}`);
          } else {
            // Bundled one-time services (e.g., "Aeration, Seeding, Compost")
            // Sum up prices for all services in the bundle
            const serviceNames = serviceType.split(', ').map(s => s.trim());
            let totalCents = 0;
            for (const name of serviceNames) {
              const bundledItem = db.prepare(
                "SELECT * FROM estimate_items WHERE estimate_id = ? AND service_name = ? AND is_included = 1"
              ).get(schedule.estimate_id, name);
              if (bundledItem) {
                totalCents += Math.round(bundledItem.price * 100);
              }
            }
            if (totalCents > 0) {
              const description = `${serviceType} — ${estimate.customer_name}`;
              const invoice = createPerServiceInvoice(db, schedule.estimate_id, totalCents, description);
              console.log(`[per-service] Invoice ${invoice.invoice_number} created: $${(totalCents / 100).toFixed(2)} for ${description}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('[billing] Error:', err.message);
      // Non-fatal — don't fail the application creation
    }
  }

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

  // ─── Pay-Per-Service Invoice Trigger ─────────────────────
  // If property has an accepted estimate with per_service payment plan,
  // auto-create an invoice for this treatment
  if (b.property_id) {
    try {
      const estimate = db.prepare(`
        SELECT * FROM estimates
        WHERE property_id = ? AND status = 'accepted' AND payment_plan = 'per_service'
        ORDER BY accepted_at DESC LIMIT 1
      `).get(b.property_id);

      if (estimate) {
        const stripeUtils = require('../utils/stripe');
        const emailUtils = require('../utils/email');

        // Calculate per-service amount: sum of recurring service per-round prices from estimate
        const estItems = db.prepare(
          'SELECT * FROM estimate_items WHERE estimate_id = ? AND is_included = 1 AND is_recurring = 1'
        ).all(estimate.id);
        const perVisitAmount = estItems.reduce((sum, item) => sum + item.price, 0);

        if (perVisitAmount > 0) {
          const amountCents = Math.round(perVisitAmount * 100);
          const desc = `Treatment on ${b.application_date || new Date().toISOString().split('T')[0]}`;
          const invoice = stripeUtils.createPerServiceInvoice(db, estimate.id, amountCents, desc);

          console.log(`[per-service] Invoice ${invoice.invoice_number} created for $${(amountCents/100).toFixed(2)}`);

          // Send payment request email if email is configured and customer has email
          if (emailUtils.isEnabled() && estimate.email) {
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            emailUtils.sendInvoiceEmail({
              to: estimate.email,
              customerName: estimate.customer_name,
              invoiceNumber: invoice.invoice_number,
              amount: (amountCents / 100).toFixed(2),
              dueDate: invoice.due_date,
              paymentUrl: `${baseUrl}/proposal/${estimate.token}`
            }).catch(err => console.error('[per-service] Email failed:', err.message));
          }
        }
      }
    } catch (err) {
      console.error('[per-service] Invoice trigger error:', err.message);
      // Non-fatal — don't fail the application creation
    }
  }

  res.json({ id: result.lastInsertRowid });
});

// Update application (rejected if synced) — with inventory delta adjustment
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);

  if (!existing) return res.status(404).json({ error: 'Application not found' });

  if (existing.synced === 1) {
    return res.status(403).json({ error: 'Cannot edit synced application records. Records are locked for compliance.' });
  }

  const b = req.body;
  const appId = Number(req.params.id);

  const doUpdate = db.transaction(() => {
    // --- Inventory adjustment on edit ---
    const oldProductId = existing.product_id;
    const oldAmount = Number(existing.total_product_used) || 0;
    const newProductId = Number(b.product_id);
    const newAmount = Number(b.total_product_used) || 0;

    if (oldProductId === newProductId) {
      // Same product: adjust by delta
      const delta = oldAmount - newAmount; // positive = used less, give back
      if (delta !== 0) {
        const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(oldProductId);
        if (inv) {
          db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
            .run(inv.quantity + delta, oldProductId);
          db.prepare('INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)')
            .run(oldProductId, delta, 'application_edit', appId, req.session.userId);
        }
      }
    } else {
      // Product changed: reverse old deduction, apply new deduction
      if (oldProductId && oldAmount > 0) {
        const oldInv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(oldProductId);
        if (oldInv) {
          db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
            .run(oldInv.quantity + oldAmount, oldProductId);
          db.prepare('INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)')
            .run(oldProductId, oldAmount, 'application_edit_reversal', appId, req.session.userId);
        }
      }
      if (newProductId && newAmount > 0) {
        const newInv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(newProductId);
        if (newInv) {
          db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
            .run(newInv.quantity - newAmount, newProductId);
          db.prepare('INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)')
            .run(newProductId, -newAmount, 'application_edit_new', appId, req.session.userId);
        }
      }
    }

    // Update the application record
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
        notes = ?, property_id = ?,
        duration_minutes = ?, labor_cost = ?, material_cost = ?, revenue = ?
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
      b.duration_minutes || null, b.labor_cost || null, b.material_cost || null, b.revenue || null,
      appId
    );
  });

  try {
    doUpdate();
    logAudit(db, 'application', appId, req.session.userId, 'update', { before: existing, after: b });
    res.json({ success: true });
  } catch (err) {
    console.error('Application edit error:', err);
    res.status(500).json({ error: 'Failed to update application' });
  }
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
          notes, property_id, retention_years,
          duration_minutes, labor_cost, material_cost, revenue
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        b.notes || null, b.property_id || null, retentionYears,
        b.duration_minutes || null, b.labor_cost || null, b.material_cost || null, b.revenue || null
      );
      // Auto-deduct inventory for synced record
      if (b.product_id && b.total_product_used) {
        const inv = db.prepare('SELECT * FROM inventory WHERE product_id = ?').get(b.product_id);
        if (inv) {
          const newQty = inv.quantity - Number(b.total_product_used);
          db.prepare('UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?')
            .run(newQty, b.product_id);
          db.prepare('INSERT INTO inventory_log (product_id, change_amount, reason, application_id, user_id) VALUES (?, ?, ?, ?, ?)')
            .run(b.product_id, -Number(b.total_product_used), 'application_sync', result.lastInsertRowid, req.session.userId);
        }
      }

      logAudit(db, 'application', result.lastInsertRowid, req.session.userId, 'sync_create', b);
      synced.push(result.lastInsertRowid);
    } catch (e) {
      console.error('Sync error for record:', e.message);
    }
  }

  res.json({ synced: synced.length, ids: synced });
});

module.exports = router;
