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

/**
 * Handle billing when a scheduled visit is marked completed.
 *
 * This is the single source of truth for "a visit was completed, do the
 * billing." It was previously duplicated verbatim in routes/schedules.js and
 * routes/applications.js — the copy-paste that caused the Amanda Boman
 * double-billing bug. Both call sites now delegate here.
 *
 * - monthly plan  → activate the scheduled installments (idempotent)
 * - per_service   → create one invoice for this visit, priced from the
 *                   estimate's matching line item (or the sum of a bundled
 *                   service label like "Aeration, Seeding, Compost")
 * - full / other  → no-op
 *
 * `schedule` is a row from the schedules table (must have estimate_id,
 * service_type, round_number, total_rounds). Errors are non-fatal: they are
 * logged and swallowed so they never fail the caller's main operation.
 *
 * @returns {object} a small result for logging/tests, e.g.
 *   { action: 'activated' | 'per_service_invoice' | 'none', invoice_number?, amount? }
 */
function billForCompletedVisit(db, schedule) {
  try {
    if (!schedule || !schedule.estimate_id) return { action: 'none', reason: 'no_estimate' };

    const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(schedule.estimate_id);
    if (!estimate) return { action: 'none', reason: 'estimate_not_found' };

    if (estimate.payment_plan === 'monthly') {
      const activated = activateBillingForEstimate(db, schedule.estimate_id);
      return { action: activated ? 'activated' : 'none', reason: activated ? undefined : 'not_first_visit' };
    }

    if (estimate.payment_plan === 'per_service') {
      const { createPerServiceInvoice } = require('./stripe');
      const serviceType = schedule.service_type || 'Service';
      const roundInfo = schedule.round_number ? ` (Round ${schedule.round_number}/${schedule.total_rounds})` : '';

      // Exact line-item match first.
      const item = db.prepare(
        "SELECT * FROM estimate_items WHERE estimate_id = ? AND service_name = ? AND is_included = 1"
      ).get(schedule.estimate_id, serviceType);

      let amountCents = 0;
      if (item) {
        amountCents = Math.round(item.price * 100);
      } else {
        // Bundled label (e.g. "Aeration, Seeding, Compost") → sum the parts.
        for (const name of serviceType.split(',').map(s => s.trim())) {
          const bundledItem = db.prepare(
            "SELECT * FROM estimate_items WHERE estimate_id = ? AND service_name = ? AND is_included = 1"
          ).get(schedule.estimate_id, name);
          if (bundledItem) amountCents += Math.round(bundledItem.price * 100);
        }
      }

      if (amountCents > 0) {
        const description = `${serviceType}${item ? roundInfo : ''} — ${estimate.customer_name}`;
        const invoice = createPerServiceInvoice(db, schedule.estimate_id, amountCents, description);
        console.log(`[per-service] Invoice ${invoice.invoice_number} created: $${(amountCents / 100).toFixed(2)} for ${description}`);
        return { action: 'per_service_invoice', invoice_number: invoice.invoice_number, amount: amountCents / 100 };
      }
      return { action: 'none', reason: 'no_priced_items' };
    }

    return { action: 'none', reason: `plan_${estimate.payment_plan}` };
  } catch (err) {
    console.error('[billing] Error:', err.message);
    return { action: 'error', error: err.message };
  }
}

module.exports = { activateBillingForEstimate, billForCompletedVisit };
