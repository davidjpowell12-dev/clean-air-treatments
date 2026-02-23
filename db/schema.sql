CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician',
  applicator_cert_number TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  epa_reg_number TEXT,
  active_ingredients TEXT,
  product_type TEXT NOT NULL,
  formulation TEXT,
  unit_of_measure TEXT NOT NULL,
  package_size REAL,
  cost_per_unit REAL,
  app_rate_low REAL,
  app_rate_high REAL,
  app_rate_unit TEXT,
  mix_rate_oz_per_gal REAL,
  spray_volume_gal_per_1000 REAL,
  is_restricted_use INTEGER DEFAULT 0,
  signal_word TEXT,
  rei_hours REAL,
  data_sheet_url TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  quantity REAL NOT NULL DEFAULT 0,
  reorder_threshold REAL DEFAULT 0,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change_amount REAL NOT NULL,
  reason TEXT,
  application_id INTEGER REFERENCES applications(id),
  user_id INTEGER REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicator_id INTEGER NOT NULL REFERENCES users(id),
  applicator_cert_number TEXT,
  application_date DATE NOT NULL,
  start_time TEXT,
  end_time TEXT,
  customer_name TEXT,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT DEFAULT 'MI',
  zip TEXT,
  property_sqft REAL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  epa_reg_number TEXT,
  app_rate_used REAL NOT NULL,
  app_rate_unit TEXT NOT NULL,
  total_product_used REAL NOT NULL,
  total_area_treated REAL NOT NULL,
  dilution_rate TEXT,
  total_mix_volume REAL,
  application_method TEXT,
  target_pest TEXT,
  temperature_f REAL,
  wind_speed_mph REAL,
  wind_direction TEXT,
  weather_conditions TEXT,
  lawn_markers_posted INTEGER DEFAULT 0,
  notification_registry_checked INTEGER DEFAULT 0,
  is_restricted_use INTEGER DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  synced INTEGER DEFAULT 1
);

-- Properties (customer/service locations)
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT DEFAULT 'MI',
  zip TEXT,
  sqft REAL,
  soil_type TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_properties_customer ON properties(customer_name);
CREATE INDEX IF NOT EXISTS idx_properties_address ON properties(address);

-- Audit log (immutable record of all changes)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  changes_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_record ON audit_log(record_type, record_id);

-- Schema version for migrations
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL DEFAULT 0
);

-- IPM Cases
CREATE TABLE IF NOT EXISTS ipm_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  issue_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_ipm_cases_property ON ipm_cases(property_id);
CREATE INDEX IF NOT EXISTS idx_ipm_cases_status ON ipm_cases(status);

-- IPM Observations
CREATE TABLE IF NOT EXISTS ipm_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL REFERENCES ipm_cases(id) ON DELETE CASCADE,
  notes TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- IPM Photos
CREATE TABLE IF NOT EXISTS ipm_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES ipm_observations(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Purchases (formal purchase records for COGS tracking)
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
);

CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_po ON purchases(po_number);

-- Trigger to auto-create inventory row when a product is inserted
CREATE TRIGGER IF NOT EXISTS create_inventory_on_product_insert
AFTER INSERT ON products
BEGIN
  INSERT INTO inventory (product_id, quantity) VALUES (NEW.id, 0);
END;
