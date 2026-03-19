// Versioned schema migrations for existing databases
// New installs get the full schema from schema.sql; migrations handle ALTER TABLE for existing DBs

const crypto = require('crypto');

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
  },
  // Migration 11: Create services + pricing_tiers tables for estimates & proposals
  function createServicesPricingTables(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        is_recurring INTEGER DEFAULT 0,
        rounds INTEGER DEFAULT 1,
        display_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS pricing_tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        min_sqft INTEGER NOT NULL,
        max_sqft INTEGER,
        price REAL NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_pricing_tiers_service ON pricing_tiers(service_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pricing_tiers_sqft ON pricing_tiers(min_sqft, max_sqft)');
  },
  // Migration 12: Create estimates + estimate_items tables for proposals
  function createEstimatesTables(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS estimates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER REFERENCES properties(id),
        customer_name TEXT NOT NULL,
        address TEXT,
        city TEXT,
        state TEXT DEFAULT 'MI',
        zip TEXT,
        email TEXT,
        phone TEXT,
        property_sqft REAL,
        total_price REAL DEFAULT 0,
        monthly_price REAL DEFAULT 0,
        payment_months INTEGER DEFAULT 8,
        status TEXT DEFAULT 'draft',
        valid_until DATE,
        notes TEXT,
        customer_message TEXT,
        sent_at DATETIME,
        viewed_at DATETIME,
        accepted_at DATETIME,
        declined_at DATETIME,
        last_reminder_at DATETIME,
        reminder_count INTEGER DEFAULT 0,
        max_reminders INTEGER DEFAULT 3,
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS estimate_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
        service_id INTEGER REFERENCES services(id),
        service_name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        is_recurring INTEGER DEFAULT 0,
        rounds INTEGER DEFAULT 1,
        is_included INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_estimates_property ON estimates(property_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_estimates_status ON estimates(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate ON estimate_items(estimate_id)');
  },
  // Migration 13: Add public token to estimates for client portal access
  function addEstimateToken(db) {
    try { db.exec('ALTER TABLE estimates ADD COLUMN token TEXT'); } catch (e) { /* column may already exist */ }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_estimates_token ON estimates(token)');
    // Backfill tokens for any existing estimates
    const rows = db.prepare('SELECT id FROM estimates WHERE token IS NULL').all();
    for (const row of rows) {
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('UPDATE estimates SET token = ? WHERE id = ?').run(token, row.id);
    }
  },
  // Migration 14: Invoicing & payments system (Stripe integration)
  function createInvoicingTables(db) {
    // Invoice counter for sequential numbering per year
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoice_counter (
        year INTEGER PRIMARY KEY,
        last_number INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Invoices table
    db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT NOT NULL UNIQUE,
        estimate_id INTEGER NOT NULL REFERENCES estimates(id),
        amount_cents INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payment_plan TEXT NOT NULL,
        installment_number INTEGER,
        total_installments INTEGER,
        due_date DATE,
        paid_at DATETIME,
        stripe_checkout_session_id TEXT,
        stripe_payment_intent_id TEXT,
        payment_method TEXT,
        check_number TEXT,
        check_date DATE,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_estimate ON invoices(estimate_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_invoices_stripe_session ON invoices(stripe_checkout_session_id)');

    // Add payment columns to estimates
    try { db.exec('ALTER TABLE estimates ADD COLUMN payment_plan TEXT'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE estimates ADD COLUMN stripe_customer_id TEXT'); } catch (e) { /* exists */ }
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
