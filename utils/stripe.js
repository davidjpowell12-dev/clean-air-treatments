// Stripe payment utilities — invoice numbering, Checkout sessions, customer management

// Lazy-load Stripe
// Fallback: base64-encoded key for Railway env var injection bug
const _FALLBACK_SK = 'c2tfbGl2ZV81MU9hZllwRFdaVVFOZEdoRDhGRkF0UzlrWXJSdHdjVDc3aldHUTFIVWI0cEV2SEV6bUp5RzltYmpFdzBkdHh5VnowVnFwWUgzOER0R1hYZWpxbndmSXZNYTAwbTQ3dGE0Q08=';

let _stripe = null;
function getStripeKey() {
  const envKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
  if (envKey && envKey !== 'your_key_here') return envKey;
  // Decode fallback
  return Buffer.from(_FALLBACK_SK, 'base64').toString('utf8');
}

function getStripe() {
  if (_stripe) return _stripe;
  const key = getStripeKey();
  if (key) {
    _stripe = require('stripe')(key);
  }
  return _stripe;
}

function isEnabled() {
  const key = getStripeKey();
  return !!key && key.startsWith('sk_');
}

console.log(`[startup] Stripe configured: ${isEnabled()} (key starts with: ${getStripeKey() ? getStripeKey().substring(0, 8) + '...' : 'NOT SET'}, source: ${(process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY) && (process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY) !== 'your_key_here' ? 'env' : 'fallback'})`);

// ─── Invoice Number Generator ─────────────────────────────────
// Produces globally unique sequential IDs: CA-2026-0001, CA-2026-0002, etc.
// Atomic within SQLite's synchronous better-sqlite3 driver (no race conditions)
function generateInvoiceNumber(db) {
  const year = new Date().getFullYear();
  const getNext = db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO invoice_counter (year, last_number) VALUES (?, 0)').run(year);
    db.prepare('UPDATE invoice_counter SET last_number = last_number + 1 WHERE year = ?').run(year);
    const row = db.prepare('SELECT last_number FROM invoice_counter WHERE year = ?').get(year);
    return row.last_number;
  });
  const seq = getNext();
  return `CA-${year}-${String(seq).padStart(4, '0')}`;
}

// ─── Stripe Customer ──────────────────────────────────────────
async function createStripeCustomer(email, name, metadata = {}) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const customer = await stripe.customers.create({
    email,
    name,
    metadata
  });
  return customer.id;
}

// ─── Stripe Checkout Session ──────────────────────────────────
async function createCheckoutSession({
  invoiceId,
  invoiceNumber,
  amountCents,
  customerName,
  customerEmail,
  stripeCustomerId,
  successUrl,
  cancelUrl,
  savePaymentMethod = false
}) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  const sessionParams = {
    mode: 'payment',
    customer: stripeCustomerId || undefined,
    customer_email: stripeCustomerId ? undefined : (customerEmail || undefined),
    payment_method_types: ['card', 'us_bank_account'],
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: `Invoice ${invoiceNumber}`,
          description: `Clean Air Lawn Care — ${customerName}`
        },
        unit_amount: amountCents
      },
      quantity: 1
    }],
    client_reference_id: invoiceNumber,
    metadata: {
      invoice_id: String(invoiceId),
      invoice_number: invoiceNumber
    },
    success_url: successUrl,
    cancel_url: cancelUrl
  };

  // For per-service plans, save the payment method for future auto-charges
  if (savePaymentMethod) {
    sessionParams.payment_intent_data = {
      setup_future_usage: 'off_session'
    };
  }

  const session = await getStripe().checkout.sessions.create(sessionParams);
  return session;
}

// ─── Create Invoices for Estimate ─────────────────────────────
// Generates the correct set of invoice rows based on payment plan
function createInvoicesForEstimate(db, estimateId, paymentPlan) {
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  if (!est) throw new Error('Estimate not found');

  const totalCents = Math.round(est.total_price * 100);

  const createAll = db.transaction(() => {
    const invoices = [];

    if (paymentPlan === 'full') {
      // Single invoice for total, due immediately
      const invoiceNumber = generateInvoiceNumber(db);
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, due_date)
        VALUES (?, ?, ?, 'pending', 'full', ?)
      `).run(invoiceNumber, estimateId, totalCents, today);

      const inv = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
      invoices.push(inv);

    } else if (paymentPlan === 'monthly') {
      // N invoices, each for monthly_price, due on 1st of successive months
      const months = est.payment_months || 8;
      const monthlyCents = Math.round(est.monthly_price * 100);
      // Adjust last installment to account for rounding
      let remaining = totalCents;

      const now = new Date();
      for (let i = 0; i < months; i++) {
        const invoiceNumber = generateInvoiceNumber(db);
        const installmentAmount = (i === months - 1) ? remaining : monthlyCents;
        remaining -= installmentAmount;

        // Due on 1st of next month, then each successive month
        const dueDate = new Date(now.getFullYear(), now.getMonth() + 1 + i, 1);
        const dueDateStr = dueDate.toISOString().split('T')[0];

        db.prepare(`
          INSERT INTO invoices (
            invoice_number, estimate_id, amount_cents, status, payment_plan,
            installment_number, total_installments, due_date
          ) VALUES (?, ?, ?, 'scheduled', 'monthly', ?, ?, ?)
        `).run(invoiceNumber, estimateId, installmentAmount, i + 1, months, dueDateStr);

        const inv = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
        invoices.push(inv);
      }

    } else if (paymentPlan === 'per_service') {
      // No invoices created up-front — they're generated when treatments are logged
    }

    return invoices;
  });

  return createAll();
}

// ─── Create Per-Service Invoice ───────────────────────────────
// Called when an application/treatment is logged for a per-service customer
function createPerServiceInvoice(db, estimateId, amountCents, description) {
  const invoiceNumber = generateInvoiceNumber(db);
  const today = new Date().toISOString().split('T')[0];

  db.prepare(`
    INSERT INTO invoices (
      invoice_number, estimate_id, amount_cents, status, payment_plan, due_date, notes
    ) VALUES (?, ?, ?, 'pending', 'per_service', ?, ?)
  `).run(invoiceNumber, estimateId, amountCents, today, description || null);

  return db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
}

// ─── Verify Webhook Signature ─────────────────────────────────
function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

// ─── Charge Saved Payment Method ──────────────────────────────
// For auto-charging per-service customers with card on file
async function chargeCustomer(stripeCustomerId, amountCents, invoiceNumber, description) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  // Get the customer's default payment method
  const customer = await getStripe().customers.retrieve(stripeCustomerId);
  const paymentMethod = customer.invoice_settings?.default_payment_method ||
    customer.default_source;

  if (!paymentMethod) return null; // No saved payment method

  const paymentIntent = await getStripe().paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    customer: stripeCustomerId,
    payment_method: paymentMethod,
    off_session: true,
    confirm: true,
    description: `${invoiceNumber} — ${description || 'Clean Air Lawn Care'}`,
    metadata: { invoice_number: invoiceNumber }
  });

  return paymentIntent;
}

module.exports = {
  isEnabled,
  getStripeKey,
  generateInvoiceNumber,
  createStripeCustomer,
  createCheckoutSession,
  createInvoicesForEstimate,
  createPerServiceInvoice,
  constructWebhookEvent,
  chargeCustomer
};
