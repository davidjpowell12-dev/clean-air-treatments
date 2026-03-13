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
  },
  // Migration 5: Add email and phone to properties
  function addPropertyContactFields(db) {
    try { db.exec('ALTER TABLE properties ADD COLUMN email TEXT'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE properties ADD COLUMN phone TEXT'); } catch (e) { /* exists */ }
  },
  // Migration 6: Create schedules table
  function createSchedulesTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id),
        scheduled_date DATE NOT NULL,
        assigned_to INTEGER REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'scheduled',
        sort_order INTEGER DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_date ON schedules(scheduled_date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_property ON schedules(property_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_assigned ON schedules(assigned_to)');
  },
  // Migration 7: Add program scheduling columns for multi-visit seasons
  function addProgramSchedulingColumns(db) {
    try { db.exec('ALTER TABLE schedules ADD COLUMN round_number INTEGER'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE schedules ADD COLUMN total_rounds INTEGER DEFAULT 6'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE schedules ADD COLUMN program_id TEXT'); } catch (e) { /* exists */ }
    db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_program ON schedules(program_id)');
  },
  // Migration 8: Add barcode field to products for UPC scanning
  function addBarcodeToProducts(db) {
    try { db.exec('ALTER TABLE products ADD COLUMN barcode TEXT'); } catch (e) { /* exists */ }
    db.exec('CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)');
  },
  // Migration 9: Create soil_tests table for lab soil test results
  function createSoilTestsTable(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS soil_tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        test_date DATE NOT NULL,
        lab_name TEXT,
        ph REAL,
        buffer_ph REAL,
        organic_matter_pct REAL,
        nitrogen_ppm REAL,
        phosphorus_ppm REAL,
        potassium_ppm REAL,
        calcium_ppm REAL,
        magnesium_ppm REAL,
        sulfur_ppm REAL,
        cec REAL,
        recommendations TEXT,
        notes TEXT,
        file_path TEXT,
        original_filename TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_soil_tests_property ON soil_tests(property_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_soil_tests_date ON soil_tests(test_date)');
  },
  // Migration 10: Expand soil_tests for Logan Labs report format
  function expandSoilTestsForLoganLabs(db) {
    const cols = [
      // Sample info
      'lab_number TEXT',
      'sample_depth_inches REAL',
      // Anions
      'phosphorus_lbs_acre REAL',
      // Exchangeable Cations (lbs/acre) - desired + found
      'calcium_lbs_acre REAL',
      'calcium_desired_lbs_acre REAL',
      'magnesium_lbs_acre REAL',
      'magnesium_desired_lbs_acre REAL',
      'potassium_lbs_acre REAL',
      'potassium_desired_lbs_acre REAL',
      'sodium_lbs_acre REAL',
      // Base Saturation %
      'base_sat_calcium_pct REAL',
      'base_sat_magnesium_pct REAL',
      'base_sat_potassium_pct REAL',
      'base_sat_sodium_pct REAL',
      'base_sat_other_pct REAL',
      'base_sat_hydrogen_pct REAL',
      // Trace Elements (ppm)
      'boron_ppm REAL',
      'iron_ppm REAL',
      'manganese_ppm REAL',
      'copper_ppm REAL',
      'zinc_ppm REAL',
      'aluminum_ppm REAL'
    ];
    for (const col of cols) {
      try { db.exec(`ALTER TABLE soil_tests ADD COLUMN ${col}`); } catch (e) { /* exists */ }
    }
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
