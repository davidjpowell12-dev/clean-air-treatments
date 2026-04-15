const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Get daily schedule (with property + tech info)
router.get('/daily', requireAuth, (req, res) => {
  const db = getDb();
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date parameter required' });

  const entries = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft, p.phone,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.scheduled_date = ?
    ORDER BY s.sort_order, s.id
  `).all(date);

  res.json(entries);
});

// Get week overview (count per day for a week)
router.get('/week', requireAuth, (req, res) => {
  const db = getDb();
  const { start } = req.query;
  if (!start) return res.status(400).json({ error: 'Start date required' });

  // Get 7 days starting from start
  const days = db.prepare(`
    SELECT scheduled_date,
           COUNT(*) as total,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
    FROM schedules
    WHERE scheduled_date >= ? AND scheduled_date < date(?, '+7 days')
    GROUP BY scheduled_date
    ORDER BY scheduled_date
  `).all(start, start);

  res.json(days);
});

// Get month overview (all entries for a given month, grouped by date)
router.get('/month', requireAuth, (req, res) => {
  const db = getDb();
  const { year, month } = req.query;
  if (!year || !month) return res.status(400).json({ error: 'year and month required' });

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;

  const entries = db.prepare(`
    SELECT s.id, s.property_id, s.scheduled_date, s.assigned_to, s.status,
           s.sort_order, s.notes, s.round_number, s.total_rounds, s.program_id, s.service_type,
           p.customer_name, p.address, p.city, p.sqft,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.scheduled_date >= ?
      AND s.scheduled_date < date(?, '+1 month')
    ORDER BY s.scheduled_date, s.sort_order, s.id
  `).all(startDate, startDate);

  const grouped = {};
  for (const e of entries) {
    if (!grouped[e.scheduled_date]) grouped[e.scheduled_date] = [];
    grouped[e.scheduled_date].push(e);
  }

  res.json({ entries, grouped });
});

// Get unscheduled properties for a given date (to add to schedule)
router.get('/unscheduled', requireAuth, (req, res) => {
  const db = getDb();
  const { date, search } = req.query;
  if (!date) return res.status(400).json({ error: 'Date parameter required' });

  let sql = `
    SELECT p.* FROM properties p
    WHERE p.id NOT IN (SELECT property_id FROM schedules WHERE scheduled_date = ?)
  `;
  const params = [date];

  if (search) {
    sql += ' AND (p.customer_name LIKE ? OR p.address LIKE ? OR p.city LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  sql += ' ORDER BY p.customer_name LIMIT 50';
  res.json(db.prepare(sql).all(...params));
});

// Generate season — bulk create rounds for selected properties
router.post('/generate-season', requireAuth, (req, res) => {
  const db = getDb();
  const { property_ids, start_date, interval_weeks, assigned_to, service_type, total_rounds } = req.body;

  if (!Array.isArray(property_ids) || !start_date || !interval_weeks) {
    return res.status(400).json({ error: 'property_ids, start_date, and interval_weeks required' });
  }

  const rounds = total_rounds || 6;
  const svcType = service_type || null;
  const year = start_date.slice(0, 4);

  const generate = db.transaction(() => {
    let generated = 0;
    let skippedProperties = 0;

    for (const pid of property_ids) {
      // Skip if property already has a program for THIS service type this year
      let existing;
      if (svcType) {
        existing = db.prepare(
          "SELECT id FROM schedules WHERE property_id = ? AND program_id IS NOT NULL AND service_type = ? AND scheduled_date LIKE ?"
        ).get(pid, svcType, `${year}%`);
      } else {
        existing = db.prepare(
          "SELECT id FROM schedules WHERE property_id = ? AND program_id IS NOT NULL AND (service_type IS NULL OR service_type = '') AND scheduled_date LIKE ?"
        ).get(pid, `${year}%`);
      }
      if (existing) { skippedProperties++; continue; }

      const programId = `pgm_${Date.now()}_${pid}_${(svcType || 'general').replace(/\s+/g, '_')}`;

      for (let round = 1; round <= rounds; round++) {
        const offsetDays = (round - 1) * interval_weeks * 7;
        const roundDate = db.prepare("SELECT date(?, '+' || ? || ' days') as d").get(start_date, offsetDays);

        db.prepare(`
          INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, round_number, total_rounds, program_id, service_type, created_by)
          VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)
        `).run(pid, roundDate.d, assigned_to || null, round, rounds, programId, svcType, req.session.userId);
        generated++;
      }
    }
    return { generated, skippedProperties };
  });

  const result = generate();
  logAudit(db, 'schedule', 0, req.session.userId, 'generate_season', {
    start_date, interval_weeks, service_type: svcType, rounds, count: result.generated, skipped: result.skippedProperties
  });
  res.json({ generated: result.generated, skipped_properties: result.skippedProperties, rounds, service_type: svcType });
});

// Get properties without a season for a given year (optionally filtered by service type)
router.get('/unscheduled-programs', requireAuth, (req, res) => {
  const db = getDb();
  const { year, search, service_type } = req.query;
  if (!year) return res.status(400).json({ error: 'Year parameter required' });

  // First, backfill any schedule entries missing service_type by looking at linked estimate_items
  const nullEntries = db.prepare(`
    SELECT s.id, s.estimate_id FROM schedules s
    WHERE s.service_type IS NULL AND s.estimate_id IS NOT NULL AND s.program_id IS NOT NULL
  `).all();
  if (nullEntries.length > 0) {
    const updateStmt = db.prepare('UPDATE schedules SET service_type = ? WHERE id = ?');
    for (const entry of nullEntries) {
      // Get the primary recurring service name from the estimate
      const item = db.prepare(`
        SELECT service_name FROM estimate_items
        WHERE estimate_id = ? AND is_included = 1 AND is_recurring = 1
        ORDER BY sort_order, id LIMIT 1
      `).get(entry.estimate_id);
      if (item) {
        updateStmt.run(item.service_name, entry.id);
      }
    }
  }

  let subquery;
  const params = [];

  if (service_type) {
    // Find properties that DON'T have this specific service type scheduled
    // Match by exact service_type OR by fuzzy match (e.g. "Fert & Weed Control" matches search for that)
    subquery = `SELECT DISTINCT property_id FROM schedules WHERE program_id IS NOT NULL AND service_type = ? AND scheduled_date LIKE ?`;
    params.push(service_type, `${year}%`);
  } else {
    // Original behavior: properties with no program at all
    subquery = `SELECT DISTINCT property_id FROM schedules WHERE program_id IS NOT NULL AND scheduled_date LIKE ?`;
    params.push(`${year}%`);
  }

  let sql = `SELECT p.* FROM properties p
    WHERE p.id NOT IN (${subquery})`;

  if (search) {
    sql += ' AND (p.customer_name LIKE ? OR p.address LIKE ? OR p.city LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  sql += ' ORDER BY p.customer_name';
  res.json(db.prepare(sql).all(...params));
});

// Season overview — all program entries grouped by property
router.get('/season-overview', requireAuth, (req, res) => {
  const db = getDb();
  const { year } = req.query;
  if (!year) return res.status(400).json({ error: 'Year parameter required' });

  const entries = db.prepare(`
    SELECT s.id, s.property_id, s.scheduled_date, s.status, s.round_number, s.total_rounds, s.program_id,
           p.customer_name, p.address, p.city
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    WHERE s.program_id IS NOT NULL AND s.scheduled_date LIKE ?
    ORDER BY p.customer_name, s.round_number
  `).all(`${year}%`);

  // Group by program_id
  const programs = {};
  for (const e of entries) {
    if (!programs[e.program_id]) {
      programs[e.program_id] = {
        property_id: e.property_id,
        customer_name: e.customer_name,
        address: e.address,
        city: e.city,
        program_id: e.program_id,
        rounds: []
      };
    }
    programs[e.program_id].rounds.push({
      id: e.id,
      round_number: e.round_number,
      scheduled_date: e.scheduled_date,
      status: e.status
    });
  }

  res.json(Object.values(programs));
});

// Get schedule entries for a specific property (for property detail page)
router.get('/property/:propertyId', requireAuth, (req, res) => {
  const db = getDb();
  const entries = db.prepare(`
    SELECT s.* FROM schedules s
    WHERE s.property_id = ? AND s.program_id IS NOT NULL
    ORDER BY s.round_number
  `).all(req.params.propertyId);
  res.json(entries);
});

// Reschedule a single entry to a new date
router.put('/:id/reschedule', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });

  const { new_date } = req.body;
  if (!new_date) return res.status(400).json({ error: 'new_date required' });

  db.prepare(
    'UPDATE schedules SET scheduled_date = ?, sort_order = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(new_date, req.params.id);

  const updated = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.id = ?
  `).get(req.params.id);

  logAudit(db, 'schedule', req.params.id, req.session.userId, 'reschedule', {
    old_date: existing.scheduled_date, new_date
  });
  res.json(updated);
});

// Cancel entire season (delete non-completed program entries)
router.delete('/program/:programId', requireAuth, (req, res) => {
  const db = getDb();
  const entries = db.prepare(
    "SELECT * FROM schedules WHERE program_id = ?"
  ).all(req.params.programId);

  if (entries.length === 0) return res.status(404).json({ error: 'Program not found' });

  const result = db.prepare(
    "DELETE FROM schedules WHERE program_id = ? AND status = 'scheduled'"
  ).run(req.params.programId);

  logAudit(db, 'schedule', 0, req.session.userId, 'cancel_season', {
    program_id: req.params.programId, deleted: result.changes
  });
  res.json({ deleted: result.changes });
});

// Get single schedule entry
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const entry = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft, p.phone,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.id = ?
  `).get(req.params.id);

  if (!entry) return res.status(404).json({ error: 'Schedule entry not found' });
  res.json(entry);
});

// Add properties to schedule (bulk)
router.post('/bulk', requireAuth, (req, res) => {
  const db = getDb();
  const { property_ids, scheduled_date, assigned_to } = req.body;

  if (!Array.isArray(property_ids) || !scheduled_date) {
    return res.status(400).json({ error: 'property_ids array and scheduled_date required' });
  }

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max FROM schedules WHERE scheduled_date = ?'
  ).get(scheduled_date);

  const stmt = db.prepare(`
    INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((ids) => {
    let added = 0;
    let order = maxOrder.max;
    for (const pid of ids) {
      // Skip if already scheduled for that date
      const existing = db.prepare(
        'SELECT id FROM schedules WHERE property_id = ? AND scheduled_date = ?'
      ).get(pid, scheduled_date);
      if (existing) continue;

      order++;
      stmt.run(pid, scheduled_date, assigned_to || null, order, req.session.userId);
      added++;
    }
    return added;
  });

  const added = insertMany(property_ids);
  logAudit(db, 'schedule', 0, req.session.userId, 'bulk_add', { date: scheduled_date, count: added });
  res.json({ added });
});

// Create single schedule entry
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { property_id, scheduled_date, assigned_to, notes } = req.body;

  if (!property_id || !scheduled_date) {
    return res.status(400).json({ error: 'property_id and scheduled_date required' });
  }

  // Check not already scheduled
  const existing = db.prepare(
    'SELECT id FROM schedules WHERE property_id = ? AND scheduled_date = ?'
  ).get(property_id, scheduled_date);
  if (existing) return res.status(400).json({ error: 'Property already scheduled for this date' });

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max FROM schedules WHERE scheduled_date = ?'
  ).get(scheduled_date);

  const result = db.prepare(`
    INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(property_id, scheduled_date, assigned_to || null, maxOrder.max + 1, notes || null, req.session.userId);

  const entry = db.prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
  logAudit(db, 'schedule', entry.id, req.session.userId, 'create', entry);
  res.json(entry);
});

// Update schedule entry (status, notes, assigned_to, sort_order)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });

  const { status, notes, assigned_to, sort_order } = req.body;

  db.prepare(`
    UPDATE schedules SET
      status = COALESCE(?, status),
      notes = ?,
      assigned_to = ?,
      sort_order = COALESCE(?, sort_order),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    status || null,
    notes !== undefined ? notes : existing.notes,
    assigned_to !== undefined ? assigned_to : existing.assigned_to,
    sort_order != null ? sort_order : null,
    req.params.id
  );

  const updated = db.prepare(`
    SELECT s.*, p.customer_name, p.address, p.city, p.state, p.zip, p.sqft,
           u.full_name as assigned_to_name
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    LEFT JOIN users u ON u.id = s.assigned_to
    WHERE s.id = ?
  `).get(req.params.id);

  // ─── Billing: activate monthly invoices OR create per-service invoice ───
  if (status === 'completed' && existing.status !== 'completed' && existing.estimate_id) {
    try {
      const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(existing.estimate_id);

      if (estimate && estimate.payment_plan === 'monthly') {
        const { activateBillingForEstimate } = require('../utils/billing');
        activateBillingForEstimate(db, existing.estimate_id);

      } else if (estimate && estimate.payment_plan === 'per_service') {
        const { createPerServiceInvoice } = require('../utils/stripe');
        const serviceType = existing.service_type || 'Service';

        const item = db.prepare(
          "SELECT * FROM estimate_items WHERE estimate_id = ? AND service_name = ? AND is_included = 1"
        ).get(existing.estimate_id, serviceType);

        if (item) {
          const amountCents = Math.round(item.price * 100);
          const roundInfo = existing.round_number ? ` (Round ${existing.round_number}/${existing.total_rounds})` : '';
          const description = `${serviceType}${roundInfo} — ${estimate.customer_name}`;
          const invoice = createPerServiceInvoice(db, existing.estimate_id, amountCents, description);
          console.log(`[per-service] Invoice ${invoice.invoice_number} created: $${(amountCents / 100).toFixed(2)} for ${description}`);
        } else {
          const serviceNames = serviceType.split(', ').map(s => s.trim());
          let totalCents = 0;
          for (const name of serviceNames) {
            const bundledItem = db.prepare(
              "SELECT * FROM estimate_items WHERE estimate_id = ? AND service_name = ? AND is_included = 1"
            ).get(existing.estimate_id, name);
            if (bundledItem) totalCents += Math.round(bundledItem.price * 100);
          }
          if (totalCents > 0) {
            const description = `${serviceType} — ${estimate.customer_name}`;
            const invoice = createPerServiceInvoice(db, existing.estimate_id, totalCents, description);
            console.log(`[per-service] Invoice ${invoice.invoice_number} created: $${(totalCents / 100).toFixed(2)} for ${description}`);
          }
        }
      }
    } catch (err) {
      console.error('[billing] Error:', err.message);
    }
  }

  logAudit(db, 'schedule', req.params.id, req.session.userId, 'update', { before: existing, after: updated });
  res.json(updated);
});

// Reorder entries for a date
router.put('/reorder/:date', requireAuth, (req, res) => {
  const db = getDb();
  const { order } = req.body; // array of schedule IDs in desired order
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

  const stmt = db.prepare('UPDATE schedules SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND scheduled_date = ?');
  const reorder = db.transaction(() => {
    order.forEach((id, idx) => {
      stmt.run(idx + 1, id, req.params.date);
    });
  });
  reorder();

  res.json({ success: true });
});

// Delete schedule entry
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule entry not found' });

  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  logAudit(db, 'schedule', req.params.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// Optimize route for a date using Google Distance Matrix API
router.post('/optimize-route', requireAuth, async (req, res) => {
  const db = getDb();
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'GOOGLE_MAPS_API_KEY not configured on server' });

  const homeSetting = db.prepare("SELECT value FROM app_settings WHERE key = 'home_address'").get();
  if (!homeSetting || !homeSetting.value) {
    return res.status(400).json({ error: 'Home address not set. Add it in Settings first.' });
  }
  const homeAddress = homeSetting.value;

  const entries = db.prepare(`
    SELECT s.id, s.sort_order, p.id as property_id, p.address, p.city, p.state, p.lat, p.lng
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    WHERE s.scheduled_date = ?
    ORDER BY s.sort_order, s.id
  `).all(date);

  if (entries.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 stops to optimize' });
  }

  // Geocode a single address string → { lat, lng } or null
  const geocode = async (address) => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status === 'OK' && data.results.length > 0) return data.results[0].geometry.location;
    return null;
  };

  // Geocode home address
  const homeLoc = await geocode(homeAddress);
  if (!homeLoc) return res.status(400).json({ error: 'Could not geocode home address. Check the address in Settings.' });

  // Geocode any properties missing coordinates, cache in DB
  for (const e of entries) {
    if (e.lat && e.lng) continue;
    const addr = [e.address, e.city, e.state].filter(Boolean).join(', ');
    const loc = await geocode(addr);
    if (loc) {
      db.prepare('UPDATE properties SET lat = ?, lng = ? WHERE id = ?').run(loc.lat, loc.lng, e.property_id);
      e.lat = loc.lat;
      e.lng = loc.lng;
    }
  }

  // Build locations array: [home, ...stops]
  const locations = [homeLoc, ...entries.map(e => ({ lat: e.lat, lng: e.lng }))];
  const n = locations.length;

  // Call Distance Matrix API — batched to stay under 100 elements per request
  // Google limit: max 25 origins, max 25 destinations, max 100 elements (origins × destinations)
  const allCoords = locations.map(l => `${l.lat},${l.lng}`);
  const destStr = allCoords.join('|');
  const MAX_ELEMENTS = 100;
  const batchSize = Math.max(1, Math.floor(MAX_ELEMENTS / n)); // origins per batch

  // Initialize N×N duration matrix
  const dur = Array.from({ length: n }, () => Array(n).fill(999999));

  for (let start = 0; start < n; start += batchSize) {
    const end = Math.min(start + batchSize, n);
    const originStr = allCoords.slice(start, end).join('|');
    const dmUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originStr}&destinations=${destStr}&key=${apiKey}&mode=driving`;
    const dmRes = await fetch(dmUrl);
    const dmData = await dmRes.json();

    if (dmData.status !== 'OK') {
      return res.status(400).json({ error: `Distance Matrix API error: ${dmData.status}` });
    }

    for (let i = 0; i < dmData.rows.length; i++) {
      const origIdx = start + i;
      for (let j = 0; j < dmData.rows[i].elements.length; j++) {
        const el = dmData.rows[i].elements[j];
        dur[origIdx][j] = el.status === 'OK' ? el.duration.value : 999999;
      }
    }
  }

  // Nearest-neighbor algorithm starting from home (index 0)
  const visited = new Set([0]);
  const route = [0];
  while (visited.size < n) {
    const last = route[route.length - 1];
    let best = -1, bestDur = Infinity;
    for (let j = 1; j < n; j++) {
      if (!visited.has(j) && dur[last][j] < bestDur) {
        bestDur = dur[last][j];
        best = j;
      }
    }
    visited.add(best);
    route.push(best);
  }

  // route[0] = home, route[1..n-1] = stop indices (1-based into entries array)
  const optimized = route.slice(1).map(idx => entries[idx - 1]);

  // Total drive time along the optimized route
  let totalSeconds = 0;
  for (let i = 0; i < route.length - 1; i++) totalSeconds += dur[route[i]][route[i + 1]];
  const totalMinutes = Math.round(totalSeconds / 60);

  // Update sort_order in DB
  const updateOrder = db.transaction(() => {
    optimized.forEach((entry, idx) => {
      db.prepare('UPDATE schedules SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(idx + 1, entry.id);
    });
  });
  updateOrder();

  // Build Google Maps directions URL
  const stopAddrs = optimized.map(e => [e.address, e.city, e.state].filter(Boolean).join(', '));
  const origin = encodeURIComponent(homeAddress);
  const destination = encodeURIComponent(stopAddrs[stopAddrs.length - 1]);
  const waypointStr = stopAddrs.slice(0, -1).map(a => encodeURIComponent(a)).join('|');
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypointStr ? '&waypoints=' + waypointStr : ''}`;

  logAudit(db, 'schedule', 0, req.session.userId, 'optimize_route', { date, stops: entries.length, total_minutes: totalMinutes });

  res.json({ optimized: true, total_minutes: totalMinutes, stop_count: entries.length, order: optimized.map(e => e.id), maps_url: mapsUrl });
});

// Assign tech to all entries for a date
router.put('/assign-all/:date', requireAuth, (req, res) => {
  const db = getDb();
  const { assigned_to } = req.body;

  const result = db.prepare(
    'UPDATE schedules SET assigned_to = ?, updated_at = CURRENT_TIMESTAMP WHERE scheduled_date = ?'
  ).run(assigned_to || null, req.params.date);

  res.json({ updated: result.changes });
});

// Get technicians list
router.get('/meta/technicians', requireAuth, (req, res) => {
  const db = getDb();
  const techs = db.prepare("SELECT id, full_name, role FROM users ORDER BY full_name").all();
  res.json(techs);
});

module.exports = router;
