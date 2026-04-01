const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const backup = require('../utils/backup');

const router = express.Router();

// ── Download current database ─────────────────────────────────────────
router.get('/download', requireAdmin, (req, res) => {
  try {
    const dbPath = backup.DB_PATH;
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }

    const stats = fs.statSync(dbPath);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const filename = `clean-air-${dateStr}.db`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.sendFile(dbPath);
  } catch (err) {
    res.status(500).json({ error: 'Download failed: ' + err.message });
  }
});

// ── Trigger immediate backup to Google Drive ──────────────────────────
router.post('/now', requireAdmin, async (req, res) => {
  try {
    const result = await backup.runFullBackup();
    res.json({
      success: true,
      local: result.local,
      drive: result.drive || null,
      error: result.error || null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// ── Backup status ─────────────────────────────────────────────────────
router.get('/status', requireAdmin, async (req, res) => {
  try {
    const { lastBackupTime, lastBackupResult } = backup.getLastBackupInfo();

    // Get database size
    const dbPath = backup.DB_PATH;
    let dbSize = null;
    if (fs.existsSync(dbPath)) {
      dbSize = fs.statSync(dbPath).size;
    }

    // Get local backup count
    let localBackupCount = 0;
    if (fs.existsSync(backup.BACKUPS_DIR)) {
      localBackupCount = fs.readdirSync(backup.BACKUPS_DIR)
        .filter(f => f.endsWith('.db')).length;
    }

    // Try to get Drive backups list
    let driveBackups = [];
    try {
      driveBackups = await backup.listDriveBackups();
    } catch (driveErr) {
      console.error('[backup] Could not list Drive backups:', driveErr.message);
    }

    res.json({
      lastBackupTime,
      dbSize,
      localBackupCount,
      driveBackups: driveBackups.map(f => ({
        id: f.id,
        name: f.name,
        size: f.size ? parseInt(f.size) : null,
        createdTime: f.createdTime
      })),
      driveConfigured: !!process.env.GOOGLE_DRIVE_CREDENTIALS
    });
  } catch (err) {
    res.status(500).json({ error: 'Status check failed: ' + err.message });
  }
});

// ── CSV Export: Properties ─────────────────────────────────────────────
router.get('/export/properties', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/database');
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

// ── CSV Export: Schedules ──────────────────────────────────────────────
router.get('/export/schedules', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/database');
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

// ── CSV Export: Applications ───────────────────────────────────────────
router.get('/export/applications', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/database');
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

// ── CSV Export: Invoices ───────────────────────────────────────────────
router.get('/export/invoices', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/database');
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

// ── CSV Export: Estimates ──────────────────────────────────────────────
router.get('/export/estimates', requireAdmin, (req, res) => {
  try {
    const { getDb } = require('../db/database');
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

// ── CSV Helpers ────────────────────────────────────────────────────────

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

module.exports = router;
