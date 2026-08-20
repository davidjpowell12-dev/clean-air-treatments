// Build a deduplicated mailing list from every email address in the app,
// shaped for import into an email marketing tool (MailerLite et al).
//
// Addresses live in three places and overlap heavily:
//   properties.email  — the people we actually service
//   estimates.email   — everyone we ever quoted, converted or not
//   clients.email     — portal identities (already deduped by email)
//
// One row per address. Where an address appears more than once, the strongest
// relationship wins, so a customer who also has an old unconverted estimate is
// exported as a customer rather than a prospect.
const { normalizeEmail } = require('./clients');

// Strongest first. Used both to pick a winner and to order the output.
const SEGMENTS = ['customer', 'past_customer', 'prospect'];
const rank = (segment) => SEGMENTS.indexOf(segment);

/**
 * Split "Carol Rich" into first/last for mail-merge personalization.
 * Deliberately conservative: joint names ("Bob & Sue Smith") and single-word
 * names keep the whole string as the first name rather than guessing wrong —
 * a greeting reading "Hi Bob & Sue" is fine, "Hi &" is not.
 */
function splitName(fullName) {
  const name = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!name) return { first: '', last: '' };
  if (/[&,]| and /i.test(name)) return { first: name, last: '' };
  const parts = name.split(' ');
  if (parts.length < 2) return { first: name, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * Collect every contactable email address, deduplicated and segmented.
 * @returns {{rows: Array, counts: Object}}
 */
function buildEmailList(db) {
  const byEmail = new Map();

  // Later calls only overwrite when they carry a stronger segment, so source
  // order below doesn't silently decide the outcome.
  const add = (rawEmail, segment, { name, city, zip, phone } = {}) => {
    const email = normalizeEmail(rawEmail);
    if (!email) return; // blank, malformed, or missing an @ — never export it

    const existing = byEmail.get(email);
    if (existing && rank(existing.segment) <= rank(segment)) {
      // Keep the stronger row, but fill in any detail it was missing.
      existing.name = existing.name || name || '';
      existing.city = existing.city || city || '';
      existing.zip = existing.zip || zip || '';
      existing.phone = existing.phone || phone || '';
      return;
    }
    byEmail.set(email, {
      email, segment,
      name: (existing && existing.name) || name || '',
      city: (existing && existing.city) || city || '',
      zip: (existing && existing.zip) || zip || '',
      phone: (existing && existing.phone) || phone || '',
    });
  };

  // Serviced properties — the core list. is_active defaults to 1 on older rows.
  for (const p of db.prepare('SELECT customer_name, email, city, zip, phone, is_active FROM properties').all()) {
    add(p.email, p.is_active === 0 ? 'past_customer' : 'customer',
      { name: p.customer_name, city: p.city, zip: p.zip, phone: p.phone });
  }

  // Estimates. An accepted estimate means they became a customer even if the
  // property row is missing an address; anything else is still a prospect.
  for (const e of db.prepare('SELECT customer_name, email, city, zip, phone, status FROM estimates').all()) {
    add(e.email, e.status === 'accepted' ? 'customer' : 'prospect',
      { name: e.customer_name, city: e.city, zip: e.zip, phone: e.phone });
  }

  // Portal identities. Anyone with a client record is a real customer, but
  // this is last because it carries the least detail (no city/zip).
  for (const c of db.prepare('SELECT name, email, phone FROM clients').all()) {
    add(c.email, 'customer', { name: c.name, phone: c.phone });
  }

  const rows = [...byEmail.values()]
    .sort((a, b) => rank(a.segment) - rank(b.segment) || a.email.localeCompare(b.email))
    .map(r => {
      const { first, last } = splitName(r.name);
      return {
        email: r.email,
        first_name: first,
        last_name: last,
        full_name: r.name,
        segment: r.segment,
        city: r.city,
        zip: r.zip,
        phone: r.phone,
      };
    });

  const counts = { total: rows.length };
  for (const s of SEGMENTS) counts[s] = rows.filter(r => r.segment === s).length;
  return { rows, counts };
}

module.exports = { buildEmailList, splitName, SEGMENTS };
