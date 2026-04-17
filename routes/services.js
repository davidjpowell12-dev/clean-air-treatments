const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get all services with their pricing tiers
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const services = db.prepare('SELECT * FROM services ORDER BY display_order, id').all();

  for (const svc of services) {
    svc.tiers = db.prepare(
      'SELECT * FROM pricing_tiers WHERE service_id = ? ORDER BY min_sqft'
    ).all(svc.id);
  }

  res.json(services);
});

// Get single service with tiers
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  svc.tiers = db.prepare(
    'SELECT * FROM pricing_tiers WHERE service_id = ? ORDER BY min_sqft'
  ).all(svc.id);

  res.json(svc);
});

// Create service
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { name, description, is_recurring, rounds, display_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const result = db.prepare(`
    INSERT INTO services (name, description, is_recurring, rounds, display_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description || null, is_recurring ? 1 : 0, rounds || 1, display_order || 0);

  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'service', svc.id, req.session.userId, 'create', svc);
  res.json(svc);
});

// Update service
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  const {
    name, description, is_recurring, rounds, display_order, is_active,
    heads_up_text, completion_text, client_action
  } = req.body;

  db.prepare(`
    UPDATE services SET
      name = COALESCE(?, name),
      description = ?,
      is_recurring = COALESCE(?, is_recurring),
      rounds = COALESCE(?, rounds),
      display_order = COALESCE(?, display_order),
      is_active = COALESCE(?, is_active),
      heads_up_text = ?,
      completion_text = ?,
      client_action = ?
    WHERE id = ?
  `).run(
    name || null,
    description !== undefined ? description : existing.description,
    is_recurring !== undefined ? (is_recurring ? 1 : 0) : null,
    rounds || null,
    display_order !== undefined ? display_order : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    heads_up_text !== undefined ? heads_up_text : existing.heads_up_text,
    completion_text !== undefined ? completion_text : existing.completion_text,
    client_action !== undefined ? client_action : existing.client_action,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  logAudit(db, 'service', req.params.id, req.session.userId, 'update', { before: existing, after: updated });
  res.json(updated);
});

// Delete service (cascades to pricing_tiers)
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Service not found' });

  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  logAudit(db, 'service', req.params.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// Update a single pricing tier
router.put('/tiers/:id', requireAuth, (req, res) => {
  const db = getDb();
  const tier = db.prepare('SELECT * FROM pricing_tiers WHERE id = ?').get(req.params.id);
  if (!tier) return res.status(404).json({ error: 'Tier not found' });

  const { price } = req.body;
  if (price == null) return res.status(400).json({ error: 'Price required' });

  db.prepare('UPDATE pricing_tiers SET price = ? WHERE id = ?').run(price, req.params.id);
  res.json({ success: true });
});

// Lookup pricing for a given sqft — returns price for each active service
router.get('/pricing/lookup', requireAuth, (req, res) => {
  const db = getDb();
  const { sqft } = req.query;
  if (!sqft) return res.status(400).json({ error: 'sqft parameter required' });

  const sqftNum = Number(sqft);
  const services = db.prepare(
    'SELECT * FROM services WHERE is_active = 1 ORDER BY display_order, id'
  ).all();

  const results = services.map(svc => {
    // Find the tier where sqft falls within min_sqft..max_sqft
    // Tiers are stored as exact sqft breakpoints; find the matching or next-higher tier
    const tier = db.prepare(`
      SELECT * FROM pricing_tiers
      WHERE service_id = ? AND min_sqft >= ?
      ORDER BY min_sqft ASC LIMIT 1
    `).get(svc.id, sqftNum);

    // If no tier found at or above, use the highest tier
    const fallback = tier || db.prepare(`
      SELECT * FROM pricing_tiers
      WHERE service_id = ?
      ORDER BY min_sqft DESC LIMIT 1
    `).get(svc.id);

    const price = fallback ? fallback.price : null;

    return {
      service_id: svc.id,
      name: svc.name,
      description: svc.description,
      is_recurring: svc.is_recurring,
      rounds: svc.rounds,
      price_per_treatment: price,
      season_price: svc.is_recurring && price ? price * svc.rounds : price,
      matched_sqft: fallback ? fallback.min_sqft : null
    };
  });

  res.json(results);
});

// Import pricing matrix from CSV
// Expected format: first column is "Sq Ft", remaining columns are service names
// Service columns can have "(per treatment)", "(season)", "(monthly)", "(one-time)" suffixes
// We store the per-treatment price for recurring services and the one-time price for one-time services
router.post('/import-matrix', requireAuth, (req, res) => {
  const db = getDb();
  const { csv_content } = req.body;
  if (!csv_content) return res.status(400).json({ error: 'csv_content required' });

  try {
    const lines = csv_content.trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + at least one data row' });

    // Parse header
    const headers = parseCSVRow(lines[0]);

    // Identify service columns — group by service name
    // e.g., "Fert & Weed Control (per treatment)" → service "Fert & Weed Control", type "per treatment"
    const serviceColumns = [];
    for (let i = 1; i < headers.length; i++) {
      const raw = headers[i].trim();
      const match = raw.match(/^(.+?)\s*\((.+?)\)\s*$/);
      if (match) {
        serviceColumns.push({ index: i, name: match[1].trim(), type: match[2].trim().toLowerCase() });
      } else {
        serviceColumns.push({ index: i, name: raw, type: 'price' });
      }
    }

    // Deduplicate service names — we want one service per unique name
    const serviceMap = new Map();
    for (const col of serviceColumns) {
      if (!serviceMap.has(col.name)) {
        const isRecurring = serviceColumns.some(c => c.name === col.name && (c.type === 'per treatment' || c.type === 'season'));
        serviceMap.set(col.name, {
          name: col.name,
          is_recurring: isRecurring,
          rounds: isRecurring ? 6 : 1,
          // Which column index has the price we want to store:
          // For recurring: "per treatment" column
          // For one-time: the column itself (or first column for that service)
          priceColumnIndex: null
        });
      }
    }

    // Find the best price column for each service
    for (const col of serviceColumns) {
      const svc = serviceMap.get(col.name);
      if (svc.is_recurring && col.type === 'per treatment') {
        svc.priceColumnIndex = col.index;
      } else if (!svc.is_recurring && (col.type === 'one-time' || col.type === 'price' || svc.priceColumnIndex === null)) {
        svc.priceColumnIndex = col.index;
      }
    }

    // Parse data rows
    const tiers = [];
    for (let r = 1; r < lines.length; r++) {
      const row = parseCSVRow(lines[r]);
      if (!row.length) continue;
      const sqft = parseInt(row[0].replace(/[^0-9]/g, ''));
      if (isNaN(sqft)) continue;

      for (const [name, svc] of serviceMap) {
        if (svc.priceColumnIndex == null) continue;
        const priceStr = row[svc.priceColumnIndex];
        if (!priceStr) continue;
        const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
        if (isNaN(price)) continue;
        tiers.push({ serviceName: name, sqft, price });
      }
    }

    // Write to DB in a transaction
    const importData = db.transaction(() => {
      // Clear existing services and tiers
      db.prepare('DELETE FROM pricing_tiers').run();
      db.prepare('DELETE FROM services').run();

      const createdServices = {};
      let order = 0;

      for (const [name, svc] of serviceMap) {
        if (svc.priceColumnIndex == null) continue;
        order++;
        const result = db.prepare(`
          INSERT INTO services (name, is_recurring, rounds, display_order)
          VALUES (?, ?, ?, ?)
        `).run(name, svc.is_recurring ? 1 : 0, svc.rounds, order);
        createdServices[name] = result.lastInsertRowid;
      }

      let tierCount = 0;
      const insertTier = db.prepare(
        'INSERT INTO pricing_tiers (service_id, min_sqft, max_sqft, price) VALUES (?, ?, ?, ?)'
      );

      for (const t of tiers) {
        const serviceId = createdServices[t.serviceName];
        if (!serviceId) continue;
        insertTier.run(serviceId, t.sqft, null, t.price);
        tierCount++;
      }

      return { services: Object.keys(createdServices).length, tiers: tierCount };
    });

    const result = importData();
    logAudit(db, 'service', 0, req.session.userId, 'import_matrix', result);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse CSV: ' + err.message });
  }
});

// Simple CSV row parser (handles quoted fields with commas)
function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

module.exports = router;
