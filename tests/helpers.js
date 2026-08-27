// Shared test helpers. Builds a fresh in-memory database from the canonical
// schema.sql so tests run fast, isolated, and never touch real data.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  return db;
}

// ─── Tiny insert helpers (return the new id) ────────────────────────
function addProperty(db, customerName, address = '1 Test St') {
  return db.prepare(
    "INSERT INTO properties (customer_name, address) VALUES (?, ?)"
  ).run(customerName, address).lastInsertRowid;
}

function addEstimate(db, { propertyId, name = 'Test Customer', plan = 'monthly',
                          method = 'card', totalPrice = 1000, monthlyPrice = 125,
                          months = 8, status = 'accepted' }) {
  return db.prepare(`
    INSERT INTO estimates
      (property_id, customer_name, payment_plan, payment_method_preference,
       total_price, monthly_price, payment_months, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(propertyId, name, plan, method, totalPrice, monthlyPrice, months, status).lastInsertRowid;
}

function addItem(db, estimateId, serviceName, price, included = 1) {
  return db.prepare(
    "INSERT INTO estimate_items (estimate_id, service_name, price, is_included) VALUES (?, ?, ?, ?)"
  ).run(estimateId, serviceName, price, included).lastInsertRowid;
}

function addSchedule(db, { propertyId, estimateId = null, serviceType = 'Fert',
                          status = 'completed', round = 1, totalRounds = 6, date = '2026-06-01',
                          kind = 'service' }) {
  return db.prepare(`
    INSERT INTO schedules
      (property_id, estimate_id, scheduled_date, service_type, status, round_number, total_rounds, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(propertyId, estimateId, date, serviceType, status, round, totalRounds, kind).lastInsertRowid;
}

// The scheduled installments a monthly estimate carries before service starts.
// activateBillingForEstimate is a no-op without these.
function addScheduledInvoices(db, estimateId, count = 8, cents = 12500) {
  for (let i = 1; i <= count; i++) {
    db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, installment_number, total_installments)
                VALUES (?, ?, ?, 'scheduled', 'monthly', ?, ?)`).run(`INV-${estimateId}-${i}`, estimateId, cents, i, count);
  }
}

function getSchedule(db, id) {
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
}

function invoicesFor(db, estimateId) {
  return db.prepare(
    'SELECT * FROM invoices WHERE estimate_id = ? ORDER BY COALESCE(installment_number, 0), id'
  ).all(estimateId);
}

module.exports = {
  makeDb, addProperty, addEstimate, addItem, addSchedule, addScheduledInvoices, getSchedule, invoicesFor,
};
