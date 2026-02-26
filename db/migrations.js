// Versioned schema migrations for existing databases
// New installs get the full schema from schema.sql; migrations handle ALTER TABLE for existing DBs

const migrations = [
  // Migration 1: Add property_id and retention_years to applications
  function addPropertyColumns(db) {
    try { db.exec('ALTER TABLE applications ADD COLUMN property_id INTEGER REFERENCES properties(id)'); } catch (e) { /* column may already exist */ }
    try { db.exec('ALTER TABLE applications ADD COLUMN retention_years INTEGER DEFAULT 3'); } catch (e) { /* column may already exist */ }
  },
  // Migration 2: Create purchases table for COGS tracking
  function createPurchasesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity REAL NOT NULL,
        unit_cost REAL,
        total_cost REAL,
        po_number TEXT,
        vendor_name TEXT,
        purchase_date DATE NOT NULL,
        received_date DATE,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_purchases_po ON purchases(po_number)');
  },
  // Migration 3: Create property_zones table for yard area breakdown
  function createPropertyZonesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS property_zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        zone_name TEXT NOT NULL,
        sqft REAL NOT NULL,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_zones_property ON property_zones(property_id)');
  },
  // Migration 4: Job costing fields + app settings table
  function addJobCostingFields(db) {
    try { db.exec('ALTER TABLE applications ADD COLUMN duration_minutes REAL'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE applications ADD COLUMN labor_cost REAL'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE applications ADD COLUMN material_cost REAL'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE applications ADD COLUMN revenue REAL'); } catch (e) { /* exists */ }

    db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('hourly_labor_rate', '45')");
  }
];

function runMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)');

  let row = db.prepare('SELECT version FROM schema_version').get();
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
    row = { version: 0 };
  }

  let current = row.version;
  for (let i = current; i < migrations.length; i++) {
    console.log(`Running migration ${i + 1}...`);
    migrations[i](db);
    db.prepare('UPDATE schema_version SET version = ?').run(i + 1);
    console.log(`Migration ${i + 1} complete`);
  }
}

module.exports = { runMigrations };
