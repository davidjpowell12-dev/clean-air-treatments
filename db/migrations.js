// Versioned schema migrations for existing databases
// New installs get the full schema from schema.sql; migrations handle ALTER TABLE for existing DBs

const migrations = [
  // Migration 1: Add property_id and retention_years to applications
  function addPropertyColumns(db) {
    try { db.exec('ALTER TABLE applications ADD COLUMN property_id INTEGER REFERENCES properties(id)'); } catch (e) { /* column may already exist */ }
    try { db.exec('ALTER TABLE applications ADD COLUMN retention_years INTEGER DEFAULT 3'); } catch (e) { /* column may already exist */ }
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
