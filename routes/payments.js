const express = require('express');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');
const stripeUtils = require('../utils/stripe');
const email = require('../utils/email');

const router = express.Router();

// ─── Admin Endpoints (requireAuth) ───────────────────────────

// List all invoices with optional filters
router.get('/invoices', requireAuth, (req, res) => {
  const db = getDb();
  const { status, estimate_id, due_from, due_to } = req.query;

  let sql = `
    SELECT i.*,
      e.customer_name, e.address, e.city, e.email as customer_email, e.token as estimate_token
    FROM invoices i
    JOIN estimates e ON i.estimate_id = e.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    sql += ' AND i.status = ?';
    params.push(status);
  }
  if (estimate_id) {
    sql += ' AND i.estimate_id = ?';
    params.push(estimate_id);
  }
  if (due_from) {
    sql += ' AND i.due_date >= ?';
    params.push(due_from);
  }
  if (due_to) {
    sql += ' AND i.due_date <= ?';
    params.push(due_to);
  }

  sql += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// Get single invoice detail
router.get('/invoices/:id', requireAuth, (req, res) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*,
      e.customer_name, e.address, e.city, e.state, e.zip,
      e.email as customer_email, e.phone as customer_phone,
      e.token as estimate_token, e.total_price as estimate_total,
      e.payment_months, e.property_sqft
    FROM invoices i
    JOIN estimates e ON i.estimate_id = e.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  // Get sibling invoices (same estimate) for context
  const siblings = db.prepare(`
    SELECT id, invoice_number, amount_cents, status, installment_number, total_installments, due_date, paid_at
    FROM invoices WHERE estimate_id = ? ORDER BY installment_number, created_at
  `).all(invoice.estimate_id);

  invoice.related_invoices = siblings;
  res.json(invoice);
});

// Record a check payment
router.post('/invoices/:id/record-check', requireAuth, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });
  if (invoice.status === 'void') return res.status(400).json({ error: 'Invoice is voided' });

  const { check_number, check_date, notes } = req.body;

  db.prepare(`
    UPDATE invoices SET
      status = 'paid', payment_method = 'check', paid_at = ?,
      check_number = ?, check_date = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(new Date().toISOString(), check_number || null, check_date || null, notes || null, invoice.id);

  logAudit(db, 'invoice', invoice.id, req.session.userId, 'check_payment', {
    invoice_number: invoice.invoice_number, check_number, amount_cents: invoice.amount_cents
  });

  const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
  res.json(updated);
});

// Void an unpaid invoice
router.post('/invoices/:id/void', requireAuth, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Cannot void a paid invoice' });

  db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run('void', invoice.id);

  logAudit(db, 'invoice', invoice.id, req.session.userId, 'void', {
    invoice_number: invoice.invoice_number
  });

  res.json({ success: true, invoice_number: invoice.invoice_number });
});

// Send payment request email with Stripe Checkout link
router.post('/invoices/:id/send-payment-request', requireAuth, async (req, res) => {
  const db = getDb();
  const invoice = db.prepare(`
    SELECT i.*, e.customer_name, e.email, e.token as estimate_token, e.stripe_customer_id
    FROM invoices i JOIN estimates e ON i.estimate_id = e.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (!invoice.email) return res.status(400).json({ error: 'No customer email on this estimate' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    // Create Stripe Checkout session
    let checkoutUrl = null;
    if (stripeUtils.isEnabled()) {
      const session = await stripeUtils.createCheckoutSession({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        amountCents: invoice.amount_cents,
        customerName: invoice.customer_name,
        customerEmail: invoice.email,
        stripeCustomerId: invoice.stripe_customer_id || undefined,
        successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/proposal/${invoice.estimate_token}`,
        savePaymentMethod: invoice.payment_plan === 'per_service'
      });

      // Store session ID on invoice
      db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(session.id, invoice.id);

      checkoutUrl = session.url;
    }

    // Send email with payment link
    if (email.isEnabled()) {
      await email.sendInvoiceEmail({
        to: invoice.email,
        customerName: invoice.customer_name,
        invoiceNumber: invoice.invoice_number,
        amount: (invoice.amount_cents / 100).toFixed(2),
        dueDate: invoice.due_date,
        paymentUrl: checkoutUrl || `${baseUrl}/proposal/${invoice.estimate_token}`
      });
    }

    logAudit(db, 'invoice', invoice.id, req.session.userId, 'payment_request_sent', {
      invoice_number: invoice.invoice_number, to: invoice.email
    });

    res.json({ success: true, message: `Payment request sent to ${invoice.email}` });
  } catch (err) {
    console.error('[payments] Send payment request failed:', err.message);
    res.status(500).json({ error: 'Failed to send payment request. ' + err.message });
  }
});

// ─── Reusable auto-charge logic (called by route AND daily cron) ───
async function processDueInvoices(options = {}) {
  const { sendEmailOnNoMethod = true } = options;

  if (!stripeUtils.isEnabled()) {
    return { success: false, error: 'Stripe not configured' };
  }

  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  // Find pending invoices that are due today or overdue, with a Stripe customer on file
  const dueInvoices = db.prepare(`
    SELECT i.*, e.stripe_customer_id, e.customer_name, e.email, e.token as estimate_token
    FROM invoices i
    JOIN estimates e ON i.estimate_id = e.id
    WHERE i.status = 'pending'
      AND i.due_date <= ?
      AND e.stripe_customer_id IS NOT NULL
    ORDER BY i.due_date ASC
  `).all(today);

  const results = { charged: 0, failed: 0, no_method: 0, skipped: 0, errors: [] };

  for (const inv of dueInvoices) {
    try {
      const result = await stripeUtils.chargeCustomer(
        inv.stripe_customer_id,
        inv.amount_cents,
        inv.invoice_number,
        `Clean Air Lawn Care — ${inv.customer_name}`
      );

      if (!result) {
        // No saved payment method
        results.no_method++;

        if (sendEmailOnNoMethod && email.isEnabled() && inv.email) {
          const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
            ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
            : 'https://clean-air-treatments-production.up.railway.app';

          try {
            const session = await stripeUtils.createCheckoutSession({
              invoiceId: inv.id,
              invoiceNumber: inv.invoice_number,
              amountCents: inv.amount_cents,
              customerName: inv.customer_name,
              customerEmail: inv.email,
              stripeCustomerId: inv.stripe_customer_id,
              successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
              cancelUrl: `${baseUrl}/proposal/${inv.estimate_token}`,
              savePaymentMethod: true
            });

            db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
              .run(session.id, inv.id);

            await email.sendInvoiceEmail({
              to: inv.email,
              customerName: inv.customer_name,
              invoiceNumber: inv.invoice_number,
              amount: (inv.amount_cents / 100).toFixed(2),
              dueDate: inv.due_date,
              paymentUrl: session.url
            });
          } catch (emailErr) {
            console.error(`[auto-charge] Email fallback failed for ${inv.invoice_number}:`, emailErr.message);
          }
        } else if (!sendEmailOnNoMethod) {
          results.skipped++;
          console.log(`[auto-charge] ${inv.invoice_number} skipped — no saved payment method`);
        }
        continue;
      }

      // Payment succeeded
      db.prepare(`
        UPDATE invoices SET
          status = 'paid', paid_at = ?, payment_method = 'card',
          stripe_payment_intent_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(new Date().toISOString(), result.id, inv.id);

      logAudit(db, 'invoice', inv.id, null, 'auto_charged', {
        invoice_number: inv.invoice_number, amount_cents: inv.amount_cents,
        payment_intent: result.id
      });

      // Send receipt
      if (email.isEnabled() && inv.email) {
        email.sendPaymentConfirmationEmail({
          to: inv.email,
          customerName: inv.customer_name,
          invoiceNumber: inv.invoice_number,
          amount: (inv.amount_cents / 100).toFixed(2),
          paymentMethod: 'card'
        }).catch(err => console.error('[auto-charge] Receipt email failed:', err.message));
      }

      results.charged++;
      console.log(`[auto-charge] ${inv.invoice_number} charged $${(inv.amount_cents / 100).toFixed(2)}`);

    } catch (err) {
      results.failed++;
      results.errors.push({ invoice: inv.invoice_number, error: err.message });

      // Mark as failed
      db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('failed', inv.id);

      console.error(`[auto-charge] ${inv.invoice_number} failed:`, err.message);
    }
  }

  console.log(`[auto-charge] Complete — ${results.charged} charged, ${results.failed} failed, ${results.no_method} no method, ${results.skipped} skipped`);
  return { success: true, total_due: dueInvoices.length, ...results };
}

// Auto-charge due invoices (called by scheduled job or manually)
router.post('/process-due-invoices', requireAuth, async (req, res) => {
  const result = await processDueInvoices({ sendEmailOnNoMethod: true });
  if (!result.success) {
    return res.status(503).json({ error: result.error });
  }
  res.json(result);
});

// Dashboard summary stats
router.get('/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisYear = String(now.getFullYear());
  const today = now.toISOString().split('T')[0];

  const stats = {
    total_outstanding_cents: db.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices WHERE status IN ('pending', 'failed')"
    ).get().total,
    total_collected_month_cents: db.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices WHERE status = 'paid' AND paid_at LIKE ? || '%'"
    ).get(thisMonth).total,
    total_collected_year_cents: db.prepare(
      "SELECT COALESCE(SUM(amount_cents), 0) as total FROM invoices WHERE status = 'paid' AND paid_at LIKE ? || '%'"
    ).get(thisYear).total,
    overdue_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'pending' AND due_date < ?"
    ).get(today).count,
    pending_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status IN ('pending', 'failed')"
    ).get().count,
    paid_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'paid'"
    ).get().count,
    failed_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'failed'"
    ).get().count,
    scheduled_count: db.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE status = 'scheduled'"
    ).get().count
  };

  res.json(stats);
});

// ─── Public Endpoints (no auth) ──────────────────────────────

// Create Stripe Checkout session for a customer paying an invoice
router.post('/create-checkout/:token', async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE token = ?').get(req.params.token);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const { invoice_id } = req.body;
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ? AND estimate_id = ?')
    .get(invoice_id, est.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Invoice already paid' });

  if (!stripeUtils.isEnabled()) {
    return res.status(503).json({ error: 'Payment processing is not configured' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    const session = await stripeUtils.createCheckoutSession({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      amountCents: invoice.amount_cents,
      customerName: est.customer_name,
      customerEmail: est.email,
      stripeCustomerId: est.stripe_customer_id || undefined,
      successUrl: `${baseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/proposal/${est.token}`,
      savePaymentMethod: est.payment_plan === 'monthly' || est.payment_plan === 'per_service'
    });

    // Store session ID on invoice
    db.prepare('UPDATE invoices SET stripe_checkout_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(session.id, invoice.id);

    res.json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[payments] Checkout session creation failed:', err.message);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// ─── Stripe Webhook Handler ──────────────────────────────────
// Exported separately — mounted with express.raw() in server.js
async function webhookHandler(req, res) {
  const db = getDb();
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripeUtils.constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const invoiceId = session.metadata?.invoice_id;
        if (!invoiceId) break;

        const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(invoiceId));
        if (!invoice || invoice.status === 'paid') break;

        // Determine payment method type
        let paymentMethod = 'card';
        if (session.payment_method_types?.includes('us_bank_account') &&
            session.payment_method_collection === 'if_required') {
          paymentMethod = 'ach';
        }

        // Mark invoice as paid
        db.prepare(`
          UPDATE invoices SET
            status = 'paid', paid_at = ?, payment_method = ?,
            stripe_payment_intent_id = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          new Date().toISOString(),
          paymentMethod,
          session.payment_intent || null,
          invoice.id
        );

        // Save Stripe customer ID on the estimate for future auto-charges
        if (session.customer) {
          db.prepare('UPDATE estimates SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?')
            .run(session.customer, invoice.estimate_id);
        }

        // Save payment method as default on the Stripe customer for auto-charges
        if (session.customer && session.payment_intent) {
          try {
            const stripe = require('stripe')(stripeUtils.getStripeKey());
            const pi = await stripe.paymentIntents.retrieve(session.payment_intent);
            if (pi.payment_method) {
              await stripe.customers.update(session.customer, {
                invoice_settings: { default_payment_method: pi.payment_method }
              });
              console.log(`[webhook] Saved payment method ${pi.payment_method} for customer ${session.customer}`);
            }
          } catch (pmErr) {
            console.error('[webhook] Failed to save payment method:', pmErr.message);
          }
        }

        logAudit(db, 'invoice', invoice.id, null, 'paid_via_stripe', {
          invoice_number: invoice.invoice_number,
          amount_cents: invoice.amount_cents,
          payment_intent: session.payment_intent
        });

        // Send payment confirmation email
        if (email.isEnabled()) {
          const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(invoice.estimate_id);
          if (est?.email) {
            email.sendPaymentConfirmationEmail({
              to: est.email,
              customerName: est.customer_name,
              invoiceNumber: invoice.invoice_number,
              amount: (invoice.amount_cents / 100).toFixed(2),
              paymentMethod
            }).catch(err => console.error('[webhook] Receipt email failed:', err.message));
          }
        }

        console.log(`[webhook] Invoice ${invoice.invoice_number} paid via ${paymentMethod}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        // Find invoice by payment intent
        const invoice = db.prepare(
          'SELECT * FROM invoices WHERE stripe_payment_intent_id = ?'
        ).get(pi.id);

        if (invoice) {
          db.prepare('UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('failed', invoice.id);
          console.log(`[webhook] Invoice ${invoice.invoice_number} payment failed`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('[webhook] Processing error:', err.message);
  }

  // Always return 200 to acknowledge receipt
  res.json({ received: true });
}

router.webhookHandler = webhookHandler;
router.processDueInvoices = processDueInvoices;
module.exports = router;
