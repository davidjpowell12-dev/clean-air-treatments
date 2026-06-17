// Client identity for the customer portal. A "client" is one person/email that
// may own several estimates and properties. This module owns the rules for
// turning the existing estimate data into stable client identities and for
// scoping every portal query to a single client (the security boundary).
// See docs/client-portal.md.

/** Lowercase + trim an email to a canonical key, or null if empty/invalid. */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!e || !e.includes('@')) return null;
  return e;
}

/** Find a client by normalized email, or create one. Returns the client row. */
function findOrCreateClientByEmail(db, email, { name = null, phone = null } = {}) {
  const norm = normalizeEmail(email);
  if (!norm) return null;
  let client = db.prepare('SELECT * FROM clients WHERE email = ?').get(norm);
  if (!client) {
    db.prepare('INSERT INTO clients (email, name, phone) VALUES (?, ?, ?)').run(norm, name, phone);
    client = db.prepare('SELECT * FROM clients WHERE email = ?').get(norm);
  }
  return client;
}

/**
 * Build client identities from existing estimates and link each estimate to its
 * client. Idempotent: safe to run repeatedly. Estimates without an email are
 * left unlinked (those customers log in by phone or via a staff-issued link).
 * Multi-property customers share one email, so all their estimates collapse to
 * a single client automatically.
 */
function backfillClients(db) {
  const ests = db.prepare(
    'SELECT id, customer_name, email, phone FROM estimates WHERE client_id IS NULL'
  ).all();

  let clientsCreated = 0, estimatesLinked = 0, skippedNoEmail = 0;
  const link = db.prepare('UPDATE estimates SET client_id = ? WHERE id = ?');

  const run = db.transaction(() => {
    for (const e of ests) {
      const norm = normalizeEmail(e.email);
      if (!norm) { skippedNoEmail++; continue; }
      const existed = db.prepare('SELECT id FROM clients WHERE email = ?').get(norm);
      const client = findOrCreateClientByEmail(db, norm, { name: e.customer_name, phone: e.phone });
      if (!existed) clientsCreated++;
      link.run(client.id, e.id);
      estimatesLinked++;
    }
  });
  run();

  return { clientsCreated, estimatesLinked, skippedNoEmail, totalScanned: ests.length };
}

/**
 * Resolve everything a client owns. THIS IS THE SECURITY BOUNDARY — every
 * portal request must scope to these ids and reject anything outside them.
 * A client owns: estimates where estimates.client_id = clientId, the properties
 * those estimates point at, and the invoices belonging to those estimates.
 *
 * @returns {{ estimateIds:number[], propertyIds:number[], invoiceIds:number[] }}
 */
function getClientScope(db, clientId) {
  if (!clientId) return { estimateIds: [], propertyIds: [], invoiceIds: [] };

  const estimateIds = db.prepare('SELECT id FROM estimates WHERE client_id = ?')
    .all(clientId).map(r => r.id);

  if (estimateIds.length === 0) return { estimateIds: [], propertyIds: [], invoiceIds: [] };

  const placeholders = estimateIds.map(() => '?').join(',');
  const propertyIds = db.prepare(
    `SELECT DISTINCT property_id AS id FROM estimates WHERE id IN (${placeholders}) AND property_id IS NOT NULL`
  ).all(...estimateIds).map(r => r.id);

  const invoiceIds = db.prepare(
    `SELECT id FROM invoices WHERE estimate_id IN (${placeholders})`
  ).all(...estimateIds).map(r => r.id);

  return { estimateIds, propertyIds, invoiceIds };
}

/** True iff the given invoice belongs to the client. Use before any payment action. */
function clientOwnsInvoice(db, clientId, invoiceId) {
  if (!clientId || !invoiceId) return false;
  const row = db.prepare(`
    SELECT 1 FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.id = ? AND e.client_id = ?
  `).get(invoiceId, clientId);
  return !!row;
}

module.exports = {
  normalizeEmail,
  findOrCreateClientByEmail,
  backfillClients,
  getClientScope,
  clientOwnsInvoice,
};
