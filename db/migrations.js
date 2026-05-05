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
  },
  // Migration 15: Link applications to scheduled visits
  function linkApplicationsToSchedules(db) {
    try { db.exec('ALTER TABLE applications ADD COLUMN schedule_id INTEGER REFERENCES schedules(id)'); } catch (e) { /* exists */ }
    db.exec('CREATE INDEX IF NOT EXISTS idx_applications_schedule ON applications(schedule_id)');
    // Add service_type to schedules so we know what kind of visit it is
    try { db.exec('ALTER TABLE schedules ADD COLUMN service_type TEXT'); } catch (e) { /* exists */ }
  },
  // Migration 16: Add lat/lng to properties for geocode caching (route optimization)
  function addLatLngToProperties(db) {
    try { db.exec('ALTER TABLE properties ADD COLUMN lat REAL'); } catch (e) { /* exists */ }
    try { db.exec('ALTER TABLE properties ADD COLUMN lng REAL'); } catch (e) { /* exists */ }
  },
  // Migration 17: Link schedules to estimates for estimate→schedule pipeline
  function linkSchedulesToEstimates(db) {
    try { db.exec('ALTER TABLE schedules ADD COLUMN estimate_id INTEGER REFERENCES estimates(id)'); } catch (e) { /* exists */ }
    db.exec('CREATE INDEX IF NOT EXISTS idx_schedules_estimate ON schedules(estimate_id)');
  },
  // Migration 18: Add payment_method_preference to estimates (card vs check)
  function addPaymentMethodPreference(db) {
    try { db.exec("ALTER TABLE estimates ADD COLUMN payment_method_preference TEXT DEFAULT 'card'"); } catch (e) { /* exists */ }
  },
  // Migration 19: Add Mowing service with pricing tiers
  function addMowingService(db) {
    // Check if Mowing already exists
    const existing = db.prepare("SELECT id FROM services WHERE name = 'Mowing'").get();
    if (existing) return;

    const result = db.prepare(
      "INSERT INTO services (name, description, is_recurring, rounds, display_order, is_active) VALUES ('Mowing', 'Weekly lawn mowing service', 1, 28, 0, 1)"
    ).run();
    const serviceId = result.lastInsertRowid;

    const tiers = [
      [1000, 55], [2000, 55], [3000, 55], [4000, 55], [5000, 55],
      [6000, 60], [7000, 65], [8000, 70], [9000, 75], [10000, 80],
      [12000, 88], [15000, 100], [20000, 120], [25000, 135],
      [30000, 150], [40000, 180], [50000, 210]
    ];
    const insert = db.prepare('INSERT INTO pricing_tiers (service_id, min_sqft, price) VALUES (?, ?, ?)');
    for (const [sqft, price] of tiers) {
      insert.run(serviceId, sqft, price);
    }
  },
  // Migration: Add sales_order_path to purchases for COGS documentation
  function addSalesOrderPath(db) {
    try { db.exec('ALTER TABLE purchases ADD COLUMN sales_order_path TEXT'); } catch (e) { /* column may already exist */ }
    try { db.exec('ALTER TABLE purchases ADD COLUMN sales_order_original_name TEXT'); } catch (e) { /* column may already exist */ }
  },
  // Migration: Create follow_ups table for client request tracking
  function createFollowUps(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS follow_ups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        notes TEXT,
        bucket TEXT NOT NULL DEFAULT 'today',
        waiting_on TEXT NOT NULL DEFAULT 'me',
        pinned INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_by INTEGER REFERENCES users(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        snoozed_until DATETIME
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_followups_status ON follow_ups(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_followups_property ON follow_ups(property_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_followups_bucket ON follow_ups(bucket)');
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

  // ── Idempotent schema repairs ───────────────────────────────────────
  // These run on EVERY startup to heal databases where migrations were
  // skipped or schema_version got out of sync with reality. Each guard
  // is safe to run repeatedly.
  ensureColumn(db, 'estimates', 'payment_method_preference', "TEXT DEFAULT 'card'");
  ensureColumn(db, 'estimates', 'stripe_customer_id', 'TEXT');
  ensureColumn(db, 'purchases', 'sales_order_path', 'TEXT');
  ensureColumn(db, 'purchases', 'sales_order_original_name', 'TEXT');
  ensureColumn(db, 'follow_ups', 'linked_estimate_id', 'INTEGER REFERENCES estimates(id) ON DELETE SET NULL');

  // Receipts: each invoice gets a unique public token so customers can view
  // a branded receipt page at /receipt/:token without authentication.
  ensureColumn(db, 'invoices', 'token', 'TEXT');

  // Track when we sent the customer the invoice link via SMS, so the
  // Invoicing page can distinguish "Unsent" from "Sent, awaiting payment".
  // Without this, the only way to track SMS-sent state was by the customer
  // tapping the link and creating a Stripe checkout session — leaving a
  // gap for check customers and for cards-paying customers who haven't
  // tapped yet.
  ensureColumn(db, 'invoices', 'sms_sent_at', 'DATETIME');
  // Backfill tokens for any existing invoices that lack one
  const missingTokens = db.prepare("SELECT id FROM invoices WHERE token IS NULL OR token = ''").all();
  if (missingTokens.length > 0) {
    const crypto = require('crypto');
    const stmt = db.prepare('UPDATE invoices SET token = ? WHERE id = ?');
    for (const row of missingTokens) {
      stmt.run(crypto.randomBytes(16).toString('hex'), row.id);
    }
    console.log(`[schema-repair] Backfilled receipt tokens for ${missingTokens.length} invoice(s)`);
  }

  // Properties without sqft: borrow from the most recent application's
  // total_area_treated. Idempotent — only updates rows that are still null/0.
  const sqftBackfill = db.prepare(`
    UPDATE properties SET sqft = (
      SELECT a.total_area_treated FROM applications a
      WHERE a.property_id = properties.id
        AND a.total_area_treated > 0
      ORDER BY a.application_date DESC LIMIT 1
    )
    WHERE (sqft IS NULL OR sqft = 0)
      AND EXISTS (
        SELECT 1 FROM applications a
        WHERE a.property_id = properties.id AND a.total_area_treated > 0
      )
  `).run();
  if (sqftBackfill.changes > 0) {
    console.log(`[schema-repair] Backfilled sqft from applications for ${sqftBackfill.changes} property(ies)`);
  }

  // Messaging: per-service text templates used when composing SMS drafts.
  ensureColumn(db, 'services', 'heads_up_text', 'TEXT');
  ensureColumn(db, 'services', 'completion_text', 'TEXT');
  ensureColumn(db, 'services', 'client_action', 'TEXT');
  // Does completing a visit of this service require a full MDARD-
  // compliant application record (product, EPA#, rates, etc), or is
  // a simple "done" click enough? Default 1 (safe — assumes chemical).
  // Admin can uncheck for non-chemical services like Mowing, Clean-Ups,
  // Aeration, Seeding, Compost Topdressing.
  ensureColumn(db, 'services', 'requires_application', 'INTEGER DEFAULT 1');
  // Backfill: unset for obvious non-chemical services (one-time on first boot
  // after deploy; subsequent boots no-op because names already match)
  const nonChemicalPatterns = ['%mow%', '%clean%', '%aerat%', '%seed%', '%compost%', '%topdres%'];
  for (const pattern of nonChemicalPatterns) {
    db.prepare(
      "UPDATE services SET requires_application = 0 WHERE requires_application IS NULL OR (requires_application = 1 AND LOWER(name) LIKE ? AND (SELECT value FROM app_settings WHERE key = 'migration_nonchem_backfill_done') IS NULL)"
    ).run(pattern);
  }
  // Sentinel so we don't clobber admin changes on subsequent boots
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('migration_nonchem_backfill_done', '1')").run();

  // One-time pause of auto-charge cron after the May 1 2026 double-charge incident.
  // Sentinel ensures we only force-pause once; admin must explicitly resume via Settings UI.
  const cronPauseSentinel = db.prepare("SELECT value FROM app_settings WHERE key = 'cron_pause_2026_05_01_applied'").get();
  if (!cronPauseSentinel) {
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('cron_paused', 'true', CURRENT_TIMESTAMP)").run();
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('cron_pause_2026_05_01_applied', '1')").run();
    console.log('[migration] Auto-charge cron PAUSED — admin must resume via Settings');
  }
  // Messaging: per-property opt-in flag (default 1 — existing clients grandfathered in,
  // consistent with "established business relationship" for transactional messages).
  ensureColumn(db, 'properties', 'sms_opted_in', 'INTEGER DEFAULT 1');

  // Soft-archive: properties no longer serviced are flagged inactive so they
  // disappear from default lists but stay in the DB for historical records
  // (past applications, MDARD compliance, profitability lookback).
  ensureColumn(db, 'properties', 'is_active', 'INTEGER DEFAULT 1');

  // Drafts of outbound SMS messages. Each is composed from the visit + services + templates,
  // then presented to the user for optional editing before send.
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
      application_id INTEGER REFERENCES applications(id) ON DELETE SET NULL,
      type TEXT NOT NULL,                    -- 'heads_up' or 'completion'
      service_date DATE,                     -- day the visit happens (for heads_up) or was completed
      service_summary TEXT,                  -- e.g. "Fertilizer + Weed Control"
      composed_text TEXT NOT NULL,           -- the auto-composed starting text
      edited_text TEXT,                      -- user's edited version (null = use composed)
      to_phone TEXT,                         -- snapshot of the phone at compose time
      status TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | failed | skipped
      send_result TEXT,                      -- JSON: sid, error, dry_run, etc.
      scheduled_for DATETIME,                -- when to auto-send (null = on-demand only)
      sent_at DATETIME,
      sent_by INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_status ON message_drafts(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_type ON message_drafts(type)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_property ON message_drafts(property_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_drafts_schedule ON message_drafts(schedule_id)');

  // Fix any Bundle Discount line items that were created with is_included=0
  const fixedDiscounts = db.prepare(`
    UPDATE estimate_items SET is_included = 1
    WHERE service_name = 'Bundle Discount' AND is_included = 0
  `).run();
  if (fixedDiscounts.changes > 0) {
    console.log(`[schema-repair] Fixed ${fixedDiscounts.changes} Bundle Discount item(s) to is_included=1`);
  }

  // Recalculate total_price/monthly_price on estimates with Bundle Discount items
  // in case the totals were stored without the discount applied
  const estimatesWithDiscount = db.prepare(`
    SELECT DISTINCT e.id, e.payment_months
    FROM estimates e
    JOIN estimate_items ei ON ei.estimate_id = e.id
    WHERE ei.service_name = 'Bundle Discount'
  `).all();
  for (const est of estimatesWithDiscount) {
    const items = db.prepare('SELECT price, is_recurring, rounds FROM estimate_items WHERE estimate_id = ? AND is_included = 1').all(est.id);
    const total = items.reduce((sum, i) => sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price), 0);
    const monthly = Math.round((total / (est.payment_months || 8)) * 100) / 100;
    const updated = db.prepare('UPDATE estimates SET total_price = ?, monthly_price = ? WHERE id = ? AND total_price != ?').run(total, monthly, est.id, total);
    if (updated.changes > 0) {
      console.log(`[schema-repair] Recalculated estimate ${est.id}: total=$${total}, monthly=$${monthly}`);
    }
  }

  // Backfill: link every estimate with property_id=NULL to a property.
  // De-dupes by address first, then by normalized name, otherwise creates
  // a property from the estimate's stored customer info.
  const orphanEstimates = db.prepare(`
    SELECT id, customer_name, address, city, state, zip, email, phone, property_sqft
    FROM estimates WHERE property_id IS NULL AND customer_name IS NOT NULL
  `).all();
  if (orphanEstimates.length > 0) {
    console.log(`[schema-repair] Found ${orphanEstimates.length} estimate(s) with no linked property — backfilling...`);
    for (const e of orphanEstimates) {
      const name = (e.customer_name || '').trim();
      const addr = (e.address || '').trim();
      const normalizedName = name.replace(/\s+/g, ' ');

      let pid = null;
      if (addr) {
        const byAddr = db.prepare(
          'SELECT id FROM properties WHERE LOWER(TRIM(address)) = LOWER(TRIM(?)) LIMIT 1'
        ).get(addr);
        if (byAddr) pid = byAddr.id;
      }
      if (!pid && normalizedName) {
        const byName = db.prepare(
          "SELECT id FROM properties WHERE LOWER(TRIM(REPLACE(REPLACE(customer_name, '  ', ' '), '  ', ' '))) = LOWER(?) LIMIT 1"
        ).get(normalizedName.toLowerCase());
        if (byName) pid = byName.id;
      }
      if (!pid) {
        const result = db.prepare(`
          INSERT INTO properties (customer_name, address, city, state, zip, email, phone, sqft)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          normalizedName || 'Unknown',
          addr || '', (e.city || '').trim(), (e.state || 'MI').trim(),
          (e.zip || '').trim(), (e.email || '').trim(), (e.phone || '').trim(),
          e.property_sqft || null
        );
        pid = result.lastInsertRowid;
        console.log(`[schema-repair] Created property ${pid} for estimate ${e.id} (${normalizedName})`);
      }
      db.prepare('UPDATE estimates SET property_id = ? WHERE id = ?').run(pid, e.id);
    }
    console.log(`[schema-repair] Backfilled ${orphanEstimates.length} orphan estimate(s)`);
  }

  // ─── One-time fix: void ghost estimate 43 (Carol Rich duplicate) ──────────
  // Carol had two accepted estimates (43 and 71) each with 8 monthly invoices.
  // Estimate 71 is the real one (1 payment already made). Estimate 43 is a ghost
  // with 0 payments — voiding its invoices removes the $2,028.54 inflation.
  // Guard: only runs if estimate 43 still has non-paid invoices, so it's a no-op
  // on every subsequent boot after the first.
  const ghostInvoices = db.prepare(
    `SELECT id, invoice_number FROM invoices WHERE estimate_id = 43 AND status NOT IN ('paid','void')`
  ).all();
  if (ghostInvoices.length > 0) {
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const inv of ghostInvoices) {
        db.prepare(`UPDATE invoices SET status = 'void', updated_at = ? WHERE id = ?`).run(now, inv.id);
      }
    })();
    console.log(`[schema-repair] Voided ${ghostInvoices.length} ghost invoice(s) on estimate 43 (Carol Rich duplicate): ${ghostInvoices.map(i => i.invoice_number).join(', ')}`);
  }
}

// Add a column if it doesn't already exist. Safe to call repeatedly.
function ensureColumn(db, table, column, type) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === column)) {
      console.log(`[schema-repair] Adding ${table}.${column}`);
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  } catch (err) {
    console.error(`[schema-repair] Failed to ensure ${table}.${column}:`, err.message);
  }
}

module.exports = { runMigrations };
