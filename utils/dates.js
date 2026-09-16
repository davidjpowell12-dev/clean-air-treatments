// Calendar-date normalization.
//
// Dates are stored as 'YYYY-MM-DD' text, and the invoicing views compare them
// as strings ("due_date < today"). A date typed as '9/16/2026' was stored
// verbatim: it rendered as "Invalid Date" and, because '9/…' sorts after
// '2026-…', it was never overdue and never upcoming — the invoice disappeared
// from every view except "All". Everything that writes a date goes through here.

const pad = (n) => String(n).padStart(2, '0');

function isRealDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Accepts 'YYYY-MM-DD', 'M/D/YYYY', 'M/D/YY', 'M-D-YYYY' (surrounding
 * whitespace ignored). Returns 'YYYY-MM-DD', or null if it isn't a real date.
 */
function normalizeDate(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  let y, m, d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    [, y, m, d] = match.map(Number);
  } else if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/))) {
    [, m, d, y] = match.map(Number);
    if (y < 100) y += 2000;
  } else {
    return null;
  }
  if (!isRealDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Today in the business's timezone (the server clock is UTC). */
function todayLocal() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
}

module.exports = { normalizeDate, todayLocal };
