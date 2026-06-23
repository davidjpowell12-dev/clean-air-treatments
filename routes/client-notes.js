// Staff CRUD for client notes (observations & recommendations). Behind staff
// auth. Clients only ever READ published notes via the portal (routes/portal.js).
const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { logAudit } = require('../db/audit');

// List clients for the dedicated Notes screen picker (name/email search).
router.get('/clients', requireAuth, (req, res) => {
  const db = getDb();
  const search = String(req.query.search || '').trim();
  const rows = search
    ? db.prepare("SELECT id, name, email, phone FROM clients WHERE name LIKE ? OR email LIKE ? ORDER BY name LIMIT 200").all('%' + search + '%', '%' + search + '%')
    : db.prepare("SELECT id, name, email, phone FROM clients ORDER BY name LIMIT 200").all();
  const cnt = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(published),0) AS p FROM client_notes WHERE client_id = ?");
  const clients = rows.map(r => { const x = cnt.get(r.id); return { ...r, note_count: x.c, published_count: x.p }; });
  res.json({ ok: true, clients });
});

// List notes for a client (by client_id, or resolved from an estimate_id).
// Returns drafts too — this is the staff view.
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  let clientId = req.query.client_id ? Number(req.query.client_id) : null;
  if (!clientId && req.query.estimate_id) {
    const est = db.prepare('SELECT client_id FROM estimates WHERE id = ?').get(Number(req.query.estimate_id));
    clientId = est && est.client_id;
  }
  if (!clientId) return res.status(400).json({ error: 'client_id or estimate_id required' });

  const notes = db.prepare(`
    SELECT n.*, u.full_name AS author_name
      FROM client_notes n LEFT JOIN users u ON u.id = n.author
     WHERE n.client_id = ?
     ORDER BY n.created_at DESC, n.id DESC
  `).all(clientId);
  res.json({ ok: true, client_id: clientId, notes });
});

// Create a note. Resolves client_id/property_id from estimate_id when given.
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const b = req.body || {};
  let { client_id, property_id, visit_id, title, body, recommendation, published } = b;

  if (!client_id && b.estimate_id) {
    const est = db.prepare('SELECT client_id, property_id FROM estimates WHERE id = ?').get(Number(b.estimate_id));
    if (est) { client_id = est.client_id; property_id = property_id || est.property_id; }
  }
  if (!client_id) return res.status(400).json({ error: 'client_id (or an estimate_id with a linked client) required' });
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });

  const info = db.prepare(`
    INSERT INTO client_notes (client_id, property_id, visit_id, title, body, recommendation, published, author)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    client_id, property_id || null, visit_id || null,
    title || null, String(body).trim(), recommendation || null,
    published ? 1 : 0, req.session.userId || null
  );
  const note = db.prepare('SELECT * FROM client_notes WHERE id = ?').get(info.lastInsertRowid);
  logAudit(db, 'client_note', note.id, req.session.userId, 'create', { client_id, published: note.published });
  res.json({ ok: true, note });
});

// Update / publish-toggle a note. Any omitted field is left unchanged.
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM client_notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  const b = req.body || {};

  db.prepare(`
    UPDATE client_notes SET
      title = COALESCE(?, title),
      body = COALESCE(?, body),
      recommendation = COALESCE(?, recommendation),
      published = COALESCE(?, published),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    b.title !== undefined ? b.title : null,
    b.body !== undefined ? b.body : null,
    b.recommendation !== undefined ? b.recommendation : null,
    b.published !== undefined ? (b.published ? 1 : 0) : null,
    req.params.id
  );
  const note = db.prepare('SELECT * FROM client_notes WHERE id = ?').get(req.params.id);
  logAudit(db, 'client_note', note.id, req.session.userId, 'update', { published: note.published });
  res.json({ ok: true, note });
});

router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM client_notes WHERE id = ?').run(req.params.id);
  logAudit(db, 'client_note', Number(req.params.id), req.session.userId, 'delete', {});
  res.json({ ok: true });
});

module.exports = router;
