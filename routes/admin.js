const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'clean-air.db');
const BACKUPS_DIR = process.env.BACKUPS_DIR || path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 30;

// Ensure backups directory exists
function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

// ── Database Health Check ───────────────────────────────────────────
router.get('/health', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const result = db.pragma('integrity_check');
    const status = result[0]?.integrity_check === 'ok' ? 'ok' : 'error';
    res.json({
      status,
      integrity_check: result[0]?.integrity_check || result,
      database_path: DB_PATH,
      database_size: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed: ' + err.message });
  }
});

// ── Create Backup ───────────────────────────────────────────────────
router.post('/backup', requireAdmin, (req, res) => {
  try {
    ensureBackupsDir();

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
    const filename = `clean-air-${dateStr}_${timeStr}.db`;
    const destPath = path.join(BACKUPS_DIR, filename);

    // Use better-sqlite3's backup API for a safe copy
    const db = getDb();
    db.backup(destPath).then(() => {
      // Prune old backups
      pruneBackups();
      const stats = fs.statSync(destPath);
      res.json({
        success: true,
        filename,
        size: stats.size,
        timestamp: now.toISOString()
      });
    }).catch(err => {
      res.status(500).json({ error: 'Backup failed: ' + err.message });
    });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// ── List Backups ────────────────────────────────────────────────────
router.get('/backups', requireAdmin, (req, res) => {
  try {
    ensureBackupsDir();
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const stats = fs.statSync(path.join(BACKUPS_DIR, f));
        return {
          filename: f,
          size: stats.size,
          created: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => b.created.localeCompare(a.created));

    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups: ' + err.message });
  }
});

// ── Download Latest Backup ──────────────────────────────────────────
router.get('/backup/latest', requireAdmin, (req, res) => {
  try {
    ensureBackupsDir();
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return res.status(404).json({ error: 'No backups found' });
    }

    const latest = files[0];
    const filePath = path.join(BACKUPS_DIR, latest);
    res.setHeader('Content-Disposition', `attachment; filename="${latest}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download backup: ' + err.message });
  }
});

// ── Download Specific Backup ────────────────────────────────────────
router.get('/backups/:filename', requireAdmin, (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // prevent path traversal
    const filePath = path.join(BACKUPS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Backup not found' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download backup: ' + err.message });
  }
});

// ── Prune old backups (keep last MAX_BACKUPS) ───────────────────────
function pruneBackups() {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse();

    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS);
      for (const f of toDelete) {
        fs.unlinkSync(path.join(BACKUPS_DIR, f));
      }
    }
  } catch (err) {
    console.error('[admin] Failed to prune backups:', err.message);
  }
}

// ── Duplicate Properties Finder ─────────────────────────────────────
// Returns groups of properties that share the same address (case-insensitive)
router.get('/duplicates/properties', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    // Find addresses that appear more than once
    const dupeAddresses = db.prepare(`
      SELECT LOWER(TRIM(address)) as addr, COUNT(*) as cnt
      FROM properties
      WHERE address != ''
      GROUP BY LOWER(TRIM(address))
      HAVING COUNT(*) > 1
    `).all();

    const groups = dupeAddresses.map(({ addr, cnt }) => {
      const properties = db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM schedules WHERE property_id = p.id) as schedule_count,
          (SELECT COUNT(*) FROM applications WHERE property_id = p.id) as application_count,
          (SELECT COUNT(*) FROM estimates WHERE property_id = p.id) as estimate_count
        FROM properties p
        WHERE LOWER(TRIM(p.address)) = ?
        ORDER BY p.created_at ASC
      `).all(addr);

      // The "best" record is the one with the most linked data
      const sorted = [...properties].sort((a, b) => {
        const scoreA = a.schedule_count + a.application_count + a.estimate_count;
        const scoreB = b.schedule_count + b.application_count + b.estimate_count;
        return scoreB - scoreA;
      });

      return {
        address: properties[0].address,
        count: cnt,
        recommended_keep_id: sorted[0].id,
        properties
      };
    });

    res.json({ duplicate_groups: groups, total_duplicates: groups.reduce((sum, g) => sum + g.count - 1, 0) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to find duplicates: ' + err.message });
  }
});

// ── Merge Duplicate Properties ──────────────────────────────────────
// Reassigns all linked records from source properties to the target, then deletes the sources
router.post('/duplicates/merge', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { keep_id, remove_ids } = req.body;

    if (!keep_id || !remove_ids || !Array.isArray(remove_ids) || remove_ids.length === 0) {
      return res.status(400).json({ error: 'Provide keep_id (property to keep) and remove_ids (array of properties to merge into it)' });
    }

    // Verify the target property exists
    const target = db.prepare('SELECT * FROM properties WHERE id = ?').get(keep_id);
    if (!target) return res.status(404).json({ error: `Property ${keep_id} not found` });

    const mergeAll = db.transaction(() => {
      let totalReassigned = 0;

      for (const removeId of remove_ids) {
        if (removeId === keep_id) continue;

        // Reassign schedules
        const s = db.prepare('UPDATE schedules SET property_id = ? WHERE property_id = ?').run(keep_id, removeId);
        // Reassign applications
        const a = db.prepare('UPDATE applications SET property_id = ? WHERE property_id = ?').run(keep_id, removeId);
        // Reassign estimates
        const e = db.prepare('UPDATE estimates SET property_id = ? WHERE property_id = ?').run(keep_id, removeId);

        totalReassigned += s.changes + a.changes + e.changes;

        // Delete the duplicate property
        db.prepare('DELETE FROM properties WHERE id = ?').run(removeId);
        console.log(`[merge] Deleted property ${removeId}, reassigned ${s.changes} schedules, ${a.changes} applications, ${e.changes} estimates to property ${keep_id}`);
      }

      return totalReassigned;
    });

    const reassigned = mergeAll();
    res.json({
      success: true,
      kept: keep_id,
      removed: remove_ids.filter(id => id !== keep_id),
      records_reassigned: reassigned
    });
  } catch (err) {
    res.status(500).json({ error: 'Merge failed: ' + err.message });
  }
});

// ── CSV Export Helpers ───────────────────────────────────────────────
function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSV(rows, headers) {
  const headerLine = headers.map(h => escapeCSV(h.label)).join(',');
  const dataLines = rows.map(row =>
    headers.map(h => escapeCSV(row[h.key])).join(',')
  );
  return headerLine + '\n' + dataLines.join('\n');
}

function sendCSV(res, csv, filename) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

// ── Export Properties ───────────────────────────────────────────────
router.get('/export/properties', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM properties ORDER BY customer_name').all();
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'zip', label: 'ZIP' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'sqft', label: 'Square Feet' },
      { key: 'soil_type', label: 'Soil Type' },
      { key: 'notes', label: 'Notes' },
      { key: 'lat', label: 'Latitude' },
      { key: 'lng', label: 'Longitude' },
      { key: 'created_at', label: 'Created' },
      { key: 'updated_at', label: 'Updated' }
    ];
    sendCSV(res, toCSV(rows, headers), 'properties.csv');
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── Export Schedules ────────────────────────────────────────────────
router.get('/export/schedules', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.*, p.customer_name, p.address, p.city as property_city,
             p.state as property_state, p.zip as property_zip,
             u.full_name as assigned_to_name
      FROM schedules s
      LEFT JOIN properties p ON p.id = s.property_id
      LEFT JOIN users u ON u.id = s.assigned_to
      ORDER BY s.scheduled_date DESC, s.sort_order
    `).all();
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'scheduled_date', label: 'Scheduled Date' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'address', label: 'Address' },
      { key: 'property_city', label: 'City' },
      { key: 'property_state', label: 'State' },
      { key: 'property_zip', label: 'ZIP' },
      { key: 'assigned_to_name', label: 'Assigned To' },
      { key: 'status', label: 'Status' },
      { key: 'service_type', label: 'Service Type' },
      { key: 'round_number', label: 'Round' },
      { key: 'total_rounds', label: 'Total Rounds' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' }
    ];
    sendCSV(res, toCSV(rows, headers), 'schedules.csv');
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── Export Applications ─────────────────────────────────────────────
router.get('/export/applications', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT a.*, u.full_name as applicator_name
      FROM applications a
      LEFT JOIN users u ON u.id = a.applicator_id
      ORDER BY a.application_date DESC
    `).all();
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'application_date', label: 'Date' },
      { key: 'applicator_name', label: 'Applicator' },
      { key: 'applicator_cert_number', label: 'Cert Number' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'zip', label: 'ZIP' },
      { key: 'property_sqft', label: 'Property Sqft' },
      { key: 'product_name', label: 'Product' },
      { key: 'epa_reg_number', label: 'EPA Reg #' },
      { key: 'app_rate_used', label: 'App Rate' },
      { key: 'app_rate_unit', label: 'Rate Unit' },
      { key: 'total_product_used', label: 'Total Product Used' },
      { key: 'total_area_treated', label: 'Area Treated' },
      { key: 'dilution_rate', label: 'Dilution Rate' },
      { key: 'application_method', label: 'Method' },
      { key: 'target_pest', label: 'Target Pest' },
      { key: 'temperature_f', label: 'Temp (F)' },
      { key: 'wind_speed_mph', label: 'Wind (MPH)' },
      { key: 'wind_direction', label: 'Wind Dir' },
      { key: 'weather_conditions', label: 'Weather' },
      { key: 'start_time', label: 'Start Time' },
      { key: 'end_time', label: 'End Time' },
      { key: 'duration_minutes', label: 'Duration (min)' },
      { key: 'labor_cost', label: 'Labor Cost' },
      { key: 'material_cost', label: 'Material Cost' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' }
    ];
    sendCSV(res, toCSV(rows, headers), 'applications.csv');
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── Export Estimates ─────────────────────────────────────────────────
router.get('/export/estimates', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT e.*, u.full_name as created_by_name
      FROM estimates e
      LEFT JOIN users u ON u.id = e.created_by
      ORDER BY e.created_at DESC
    `).all();
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'address', label: 'Address' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'zip', label: 'ZIP' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'property_sqft', label: 'Square Feet' },
      { key: 'total_price', label: 'Total Price' },
      { key: 'monthly_price', label: 'Monthly Price' },
      { key: 'payment_months', label: 'Payment Months' },
      { key: 'status', label: 'Status' },
      { key: 'payment_plan', label: 'Payment Plan' },
      { key: 'created_by_name', label: 'Created By' },
      { key: 'sent_at', label: 'Sent' },
      { key: 'viewed_at', label: 'Viewed' },
      { key: 'accepted_at', label: 'Accepted' },
      { key: 'declined_at', label: 'Declined' },
      { key: 'valid_until', label: 'Valid Until' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' }
    ];
    sendCSV(res, toCSV(rows, headers), 'estimates.csv');
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── Export Invoices ──────────────────────────────────────────────────
router.get('/export/invoices', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT i.*, e.customer_name, e.address, e.email
      FROM invoices i
      LEFT JOIN estimates e ON e.id = i.estimate_id
      ORDER BY i.created_at DESC
    `).all();
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'invoice_number', label: 'Invoice Number' },
      { key: 'customer_name', label: 'Customer Name' },
      { key: 'address', label: 'Address' },
      { key: 'email', label: 'Email' },
      { key: 'amount_cents', label: 'Amount (cents)' },
      { key: 'status', label: 'Status' },
      { key: 'payment_plan', label: 'Payment Plan' },
      { key: 'installment_number', label: 'Installment #' },
      { key: 'total_installments', label: 'Total Installments' },
      { key: 'due_date', label: 'Due Date' },
      { key: 'paid_at', label: 'Paid At' },
      { key: 'payment_method', label: 'Payment Method' },
      { key: 'check_number', label: 'Check Number' },
      { key: 'notes', label: 'Notes' },
      { key: 'created_at', label: 'Created' }
    ];
    sendCSV(res, toCSV(rows, headers), 'invoices.csv');
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// ── Stripe Customer Search ─────────────────────────────────────────
router.get('/stripe-search', requireAdmin, async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const stripeUtils = require('../utils/stripe');
    if (!stripeUtils.isEnabled()) {
      return res.status(503).json({ error: 'Stripe is not configured' });
    }
    const stripe = require('stripe')(stripeUtils.getStripeKey());
    const customers = await stripe.customers.list({ email, limit: 5 });

    const results = customers.data.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      has_payment_method: !!(c.invoice_settings?.default_payment_method || c.default_source),
      created: new Date(c.created * 1000).toLocaleDateString()
    }));

    res.json(results);
  } catch (err) {
    console.error('[stripe-search] Error:', err.message);
    res.status(500).json({ error: 'Stripe search failed: ' + err.message });
  }
});

// ── Activate Client (bulk import from CoPilot) ────────────────────
router.post('/activate-client', requireAdmin, async (req, res) => {
  const db = getDb();
  const crypto = require('crypto');
  const {
    customer_name, address, city, state, zip, email, phone, property_sqft,
    items, payment_plan, payment_method, payment_months,
    stripe_customer_id, remaining_months, first_due_date, notes,
    bundle_discount
  } = req.body;

  if (!customer_name) return res.status(400).json({ error: 'Customer name required' });
  if (!items || !items.length) return res.status(400).json({ error: 'At least one service required' });

  const plan = payment_plan || 'monthly';
  const method = payment_method || 'card';
  const months = payment_months || 8;
  const remain = remaining_months || months;

  try {
    // Step 1: Create or find property
    let propertyId = null;
    if (address) {
      const existing = db.prepare(
        'SELECT id FROM properties WHERE LOWER(TRIM(address)) = LOWER(TRIM(?)) AND LOWER(TRIM(customer_name)) = LOWER(TRIM(?)) LIMIT 1'
      ).get(address, customer_name);
      if (existing) {
        propertyId = existing.id;
      }
    }
    if (!propertyId) {
      const propResult = db.prepare(`
        INSERT INTO properties (customer_name, address, city, state, zip, email, phone, sqft)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(customer_name, address || '', city || '', state || 'MI', zip || '', email || '', phone || '', property_sqft || null);
      propertyId = propResult.lastInsertRowid;
    }

    // Step 2: Calculate totals from items (minus bundle discount)
    const subtotal = items.reduce((sum, i) => {
      return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
    }, 0);
    const discount = Math.max(0, parseFloat(bundle_discount) || 0);
    const totalPrice = Math.max(0, subtotal - discount);
    const monthlyPrice = Math.round((totalPrice / months) * 100) / 100;

    // Step 3: Create pre-accepted estimate
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();

    const estResult = db.prepare(`
      INSERT INTO estimates (
        property_id, customer_name, address, city, state, zip,
        email, phone, property_sqft, total_price, monthly_price,
        payment_months, token, status, accepted_at, payment_plan,
        payment_method_preference, stripe_customer_id, notes, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      propertyId, customer_name, address || '', city || '', state || 'MI', zip || '',
      email || '', phone || '', property_sqft || null, totalPrice, monthlyPrice,
      months, token, now, plan, method, stripe_customer_id || null,
      notes || 'Imported from CoPilot', req.session.userId, now
    );
    const estId = estResult.lastInsertRowid;

    // Step 4: Create estimate items
    const insertItem = db.prepare(`
      INSERT INTO estimate_items (estimate_id, service_name, description, price, is_recurring, rounds, is_included, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      insertItem.run(estId, item.service_name, item.description || '', item.price, item.is_recurring ? 1 : 0, item.rounds || 1, i);
    }
    // Add bundle discount as a visible line item
    if (discount > 0) {
      db.prepare(`
        INSERT INTO estimate_items (estimate_id, service_name, description, price, is_recurring, rounds, is_included, sort_order)
        VALUES (?, 'Bundle Discount', 'Multi-service discount', ?, 0, 1, 1, ?)
      `).run(estId, -discount, items.length);
    }

    // Step 5: Create invoices based on plan
    const stripeUtils = require('../utils/stripe');
    let invoiceCount = 0;

    if (plan === 'full') {
      const invoiceNumber = stripeUtils.generateInvoiceNumber(db);
      const amount = method === 'card' ? Math.round(totalPrice * 100 * 1.035) : Math.round(totalPrice * 100);
      db.prepare(`
        INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, due_date)
        VALUES (?, ?, ?, 'pending', 'full', ?)
      `).run(invoiceNumber, estId, amount, first_due_date || now.split('T')[0]);
      invoiceCount = 1;

    } else if (plan === 'monthly') {
      const baseMonthlyCents = Math.round(monthlyPrice * 100);
      const monthlyCents = method === 'card' ? Math.round(baseMonthlyCents * 1.035) : baseMonthlyCents;
      const totalCents = method === 'card' ? Math.round(totalPrice * 100 * 1.035) : Math.round(totalPrice * 100);
      let remaining = totalCents;

      // Calculate start date for invoices
      const startDate = first_due_date ? new Date(first_due_date + 'T12:00:00') : new Date();

      for (let i = 0; i < remain; i++) {
        const invoiceNumber = stripeUtils.generateInvoiceNumber(db);
        const installmentAmount = (i === remain - 1) ? remaining : monthlyCents;
        remaining -= installmentAmount;

        let dueDate;
        if (first_due_date) {
          dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + i, startDate.getDate());
        } else {
          dueDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1 + i, 1);
        }
        const dueDateStr = dueDate.toISOString().split('T')[0];

        // First invoice = pending (chargeable), rest = scheduled
        const status = i === 0 ? 'pending' : 'scheduled';

        db.prepare(`
          INSERT INTO invoices (
            invoice_number, estimate_id, amount_cents, status, payment_plan,
            installment_number, total_installments, due_date
          ) VALUES (?, ?, ?, ?, 'monthly', ?, ?, ?)
        `).run(invoiceNumber, estId, installmentAmount, status, i + 1, remain, dueDateStr);
        invoiceCount++;
      }

    }
    // per_service: no invoices created up front

    console.log(`[activate] Created client ${customer_name}: property=${propertyId}, estimate=${estId}, invoices=${invoiceCount}, plan=${plan}, method=${method}, stripe=${stripe_customer_id || 'none'}`);

    res.json({
      success: true,
      property_id: propertyId,
      estimate_id: estId,
      invoices_created: invoiceCount,
      total_price: totalPrice,
      monthly_price: monthlyPrice
    });
  } catch (err) {
    console.error('[activate] FAILED:', err.stack || err);
    res.status(500).json({ error: 'Activation failed: ' + err.message });
  }
});

// ─── Audit: find estimates with line items whose rounds/is_recurring ────
// don't match the current service definition. Useful for catching cases
// where a service was imported as one-time and later flipped to recurring,
// leaving old estimate line items stuck at rounds=1.
router.get('/audit/estimate-rounds-mismatch', requireAdmin, (req, res) => {
  const db = getDb();
  const mismatches = db.prepare(`
    SELECT
      ei.id as item_id,
      ei.estimate_id,
      ei.service_name,
      ei.is_recurring as item_is_recurring,
      ei.rounds as item_rounds,
      ei.price as item_price,
      ei.is_included,
      s.id as service_id,
      s.is_recurring as service_is_recurring,
      s.rounds as service_rounds,
      e.status as estimate_status,
      e.customer_name,
      e.accepted_at
    FROM estimate_items ei
    JOIN estimates e ON e.id = ei.estimate_id
    LEFT JOIN services s ON LOWER(s.name) = LOWER(ei.service_name)
    WHERE s.id IS NOT NULL
      AND ei.is_included = 1
      AND (
        COALESCE(ei.is_recurring, 0) != COALESCE(s.is_recurring, 0)
        OR (s.is_recurring = 1 AND COALESCE(ei.rounds, 1) != COALESCE(s.rounds, 1))
      )
    ORDER BY e.customer_name, ei.service_name
  `).all();
  res.json(mismatches);
});

// Fix a single estimate_item's rounds/is_recurring to match its service.
// Does NOT alter price — we only fix the round count and recurring flag,
// then recompute estimate totals.
router.post('/fix/estimate-item-rounds/:itemId', requireAdmin, (req, res) => {
  const db = getDb();
  const item = db.prepare(`
    SELECT ei.*, e.id as est_id, e.payment_months, e.customer_name
    FROM estimate_items ei
    JOIN estimates e ON e.id = ei.estimate_id
    WHERE ei.id = ?
  `).get(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Line item not found' });

  const svc = db.prepare('SELECT * FROM services WHERE LOWER(name) = LOWER(?)').get(item.service_name);
  if (!svc) return res.status(404).json({ error: 'No matching service found for "' + item.service_name + '"' });

  const newRecurring = svc.is_recurring ? 1 : 0;
  const newRounds = svc.is_recurring ? (svc.rounds || 6) : 1;

  db.prepare(`
    UPDATE estimate_items SET
      is_recurring = ?, rounds = ?
    WHERE id = ?
  `).run(newRecurring, newRounds, item.id);

  // Recompute estimate totals so season total and monthly price reflect the new rounds.
  const included = db.prepare(
    'SELECT price, is_recurring, rounds FROM estimate_items WHERE estimate_id = ? AND is_included = 1'
  ).all(item.est_id);
  const totalPrice = included.reduce(
    (sum, i) => sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price), 0
  );
  const months = item.payment_months || 8;
  const monthlyPrice = Math.round((totalPrice / months) * 100) / 100;
  db.prepare('UPDATE estimates SET total_price = ?, monthly_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(totalPrice, monthlyPrice, item.est_id);

  res.json({
    success: true,
    item_id: item.id,
    service_name: item.service_name,
    customer_name: item.customer_name,
    before: { is_recurring: item.is_recurring, rounds: item.rounds },
    after: { is_recurring: newRecurring, rounds: newRounds },
    new_total: totalPrice,
    new_monthly: monthlyPrice
  });
});

// Bulk fix all mismatches in one call. Returns a summary.
router.post('/fix/estimate-rounds-mismatch-all', requireAdmin, (req, res) => {
  const db = getDb();
  const mismatches = db.prepare(`
    SELECT ei.id as item_id
    FROM estimate_items ei
    JOIN services s ON LOWER(s.name) = LOWER(ei.service_name)
    WHERE ei.is_included = 1
      AND (
        COALESCE(ei.is_recurring, 0) != COALESCE(s.is_recurring, 0)
        OR (s.is_recurring = 1 AND COALESCE(ei.rounds, 1) != COALESCE(s.rounds, 1))
      )
  `).all();

  const affectedEstimates = new Set();
  let fixed = 0;
  for (const m of mismatches) {
    const item = db.prepare('SELECT * FROM estimate_items WHERE id = ?').get(m.item_id);
    if (!item) continue;
    const svc = db.prepare('SELECT * FROM services WHERE LOWER(name) = LOWER(?)').get(item.service_name);
    if (!svc) continue;
    const newRecurring = svc.is_recurring ? 1 : 0;
    const newRounds = svc.is_recurring ? (svc.rounds || 6) : 1;
    db.prepare('UPDATE estimate_items SET is_recurring = ?, rounds = ? WHERE id = ?')
      .run(newRecurring, newRounds, item.id);
    affectedEstimates.add(item.estimate_id);
    fixed++;
  }

  // Recompute totals for each affected estimate
  for (const estId of affectedEstimates) {
    const est = db.prepare('SELECT payment_months FROM estimates WHERE id = ?').get(estId);
    const included = db.prepare(
      'SELECT price, is_recurring, rounds FROM estimate_items WHERE estimate_id = ? AND is_included = 1'
    ).all(estId);
    const totalPrice = included.reduce(
      (sum, i) => sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price), 0
    );
    const months = (est && est.payment_months) || 8;
    const monthlyPrice = Math.round((totalPrice / months) * 100) / 100;
    db.prepare('UPDATE estimates SET total_price = ?, monthly_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(totalPrice, monthlyPrice, estId);
  }

  res.json({
    items_fixed: fixed,
    estimates_affected: affectedEstimates.size
  });
});

module.exports = router;
