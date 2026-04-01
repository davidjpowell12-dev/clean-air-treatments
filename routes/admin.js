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

module.exports = router;
