// Billing activation utilities — activates scheduled invoices when service begins

/**
 * Activate billing for an estimate when the first visit is completed.
 * - Checks if this is the first completed visit for the estimate
 * - Flips Invoice 1 (installment_number = 1) to 'pending' with due_date = today
 * - Recalculates due_dates for invoices 2-N starting from 1st of next month
 *
 * Safe to call multiple times — only activates once (when first visit completes).
 */
function activateBillingForEstimate(db, estimateId) {
  // Check if there are any scheduled invoices for this estimate
  const scheduledInvoices = db.prepare(
    "SELECT * FROM invoices WHERE estimate_id = ? AND status = 'scheduled' ORDER BY installment_number ASC"
  ).all(estimateId);

  if (scheduledInvoices.length === 0) {
    // No scheduled invoices — either already activated, no invoices, or different plan
    return false;
  }

  // Check if this is the first completed visit for this estimate
  const completedVisits = db.prepare(
    "SELECT COUNT(*) as count FROM schedules WHERE estimate_id = ? AND status = 'completed'"
  ).get(estimateId);

  if (completedVisits.count !== 1) {
    // Not the first completed visit (either 0 which shouldn't happen, or >1 meaning already activated)
    return false;
  }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();

  const activate = db.transaction(() => {
    for (const inv of scheduledInvoices) {
      if (inv.installment_number === 1) {
        // First installment: due today, status = pending
        db.prepare(
          "UPDATE invoices SET status = 'pending', due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(today, inv.id);
        console.log(`[billing-activation] Invoice ${inv.invoice_number} (#1) activated — due today`);
      } else {
        // Subsequent installments: due on 1st of successive months starting next month
        const monthsFromNow = inv.installment_number - 1; // #2 = 1 month from now, #3 = 2 months, etc.
        const dueDate = new Date(now.getFullYear(), now.getMonth() + monthsFromNow, 1);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        db.prepare(
          "UPDATE invoices SET status = 'pending', due_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).run(dueDateStr, inv.id);
        console.log(`[billing-activation] Invoice ${inv.invoice_number} (#${inv.installment_number}) activated — due ${dueDateStr}`);
      }
    }
  });

  activate();
  console.log(`[billing-activation] Activated ${scheduledInvoices.length} invoices for estimate ${estimateId}`);
  return true;
}

module.exports = { activateBillingForEstimate };
