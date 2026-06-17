// Books reconciliation — automates the manual forensics: surfaces invoices
// and estimates whose state is internally inconsistent or out of sync with
// Stripe/QBO. Pure read-only computation over the local DB (no external API
// calls), so it's instant and safe to run anytime.
const { applyCardFee } = require('./stripe');

const NOT_VOID = "i.status NOT IN ('void', 'voided')";

/**
 * @returns {{ year, generated_for, summary, discrepancies }}
 * discrepancies is keyed by category; each value is an array of plain rows.
 */
function computeReconciliation(db, year) {
  year = String(year || new Date().getFullYear());
  const d = {};

  // 1. Paid but never synced to QBO (no invoice pushed).
  d.not_synced_to_qbo = db.prepare(`
    SELECT i.invoice_number, i.amount_cents, i.paid_at, e.customer_name
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.status = 'paid' AND i.paid_at LIKE ? || '%' AND i.qbo_invoice_id IS NULL
     ORDER BY i.paid_at DESC
  `).all(year);

  // 2. Invoice synced to QBO but the payment was never recorded there
  //    (QBO would still show it as unpaid / open).
  d.payment_not_in_qbo = db.prepare(`
    SELECT i.invoice_number, i.amount_cents, i.paid_at, e.customer_name
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.status = 'paid' AND i.paid_at LIKE ? || '%'
       AND i.qbo_invoice_id IS NOT NULL AND i.qbo_payment_id IS NULL
     ORDER BY i.paid_at DESC
  `).all(year);

  // 3. Paid by card/ACH but no Stripe payment intent on file — suspicious,
  //    means we can't trace the money to Stripe.
  d.card_paid_no_stripe = db.prepare(`
    SELECT i.invoice_number, i.amount_cents, i.payment_method, i.paid_at, e.customer_name
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.status = 'paid' AND i.paid_at LIKE ? || '%'
       AND i.payment_method IN ('card', 'ach') AND i.stripe_payment_intent_id IS NULL
     ORDER BY i.paid_at DESC
  `).all(year);

  // 4. Marked paid but missing a paid_at date — these silently drop out of
  //    the "collected this year" total. (Checked all-time, not year-scoped.)
  d.paid_without_date = db.prepare(`
    SELECT i.invoice_number, i.amount_cents, e.customer_name
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.status = 'paid' AND i.paid_at IS NULL
  `).all();

  // 5. Duplicate installments — same estimate + installment number appearing
  //    more than once (the "two invoices for the same thing" class of bug).
  d.duplicate_installments = db.prepare(`
    SELECT e.customer_name, i.estimate_id, i.installment_number, COUNT(*) AS count,
           GROUP_CONCAT(i.invoice_number) AS invoice_numbers
      FROM invoices i JOIN estimates e ON e.id = i.estimate_id
     WHERE i.installment_number IS NOT NULL AND ${NOT_VOID}
     GROUP BY i.estimate_id, i.installment_number
    HAVING COUNT(*) > 1
  `).all();

  // 6. Estimate total vs. invoiced total mismatch (fee-aware). Only meaningful
  //    for full / monthly plans that have invoices; per-service is ad hoc.
  const estimateMismatches = [];
  const ests = db.prepare(`
    SELECT id, customer_name, total_price, payment_plan, payment_method_preference
      FROM estimates
     WHERE status = 'accepted' AND payment_plan IN ('full', 'monthly')
  `).all();
  for (const e of ests) {
    const row = db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS n
         FROM invoices i WHERE i.estimate_id = ? AND ${NOT_VOID}`
    ).get(e.id);
    if (row.n === 0) continue; // not billed yet
    const method = e.payment_method_preference || 'card';
    const expected = applyCardFee(Math.round((e.total_price || 0) * 100), method);
    const diff = row.total - expected;
    if (Math.abs(diff) > 100) { // tolerance: $1 (beyond rounding)
      estimateMismatches.push({
        customer_name: e.customer_name,
        plan: e.payment_plan,
        estimate_total: e.total_price,
        expected_invoiced: expected / 100,
        actual_invoiced: row.total / 100,
        difference: diff / 100,
      });
    }
  }
  d.estimate_total_mismatch = estimateMismatches;

  // Headline numbers.
  const collected = db.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM invoices WHERE status = 'paid' AND paid_at LIKE ? || '%'`
  ).get(year).c;

  const totalIssues = Object.values(d).reduce((s, arr) => s + arr.length, 0);

  return {
    year,
    summary: {
      collected_this_year: collected / 100,
      total_discrepancies: totalIssues,
      clean: totalIssues === 0,
      counts: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.length])),
    },
    discrepancies: d,
  };
}

module.exports = { computeReconciliation };
