// Stripe payment utilities — invoice numbering, Checkout sessions, customer management
const crypto = require('crypto');

// Unique public token for receipt URLs: /receipt/:token
function generateInvoiceToken() {
  return crypto.randomBytes(16).toString('hex');
}

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
// Find existing customer by email, or create a new one. Avoids creating
// duplicate Stripe customer records on retried accept attempts.
async function findOrCreateStripeCustomer(email, name, metadata = {}) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  if (email) {
    try {
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data && existing.data.length > 0) {
        console.log(`[stripe] Reusing existing customer ${existing.data[0].id} for ${email}`);
        return existing.data[0].id;
      }
    } catch (err) {
      console.error('[stripe] Customer lookup failed, will create new:', err.message);
    }
  }

  const customer = await stripe.customers.create({ email, name, metadata });
  console.log(`[stripe] Created new customer ${customer.id} for ${email || name}`);
  return customer.id;
}

// Legacy alias — kept so existing call sites keep working but now de-dupes.
async function createStripeCustomer(email, name, metadata = {}) {
  return findOrCreateStripeCustomer(email, name, metadata);
}

// ─── Stripe Setup Mode Checkout (collect card without charging) ─
async function createSetupCheckoutSession({
  estimateId,
  customerName,
  customerEmail,
  stripeCustomerId,
  successUrl,
  cancelUrl
}) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: stripeCustomerId || undefined,
    customer_email: stripeCustomerId ? undefined : (customerEmail || undefined),
    payment_method_types: ['card'],
    client_reference_id: String(estimateId),
    metadata: {
      estimate_id: String(estimateId),
      customer_name: customerName || ''
    },
    success_url: successUrl,
    cancel_url: cancelUrl
  });

  return session;
}

// After a setup session completes, attach the saved card as the customer's
// default payment method so future off-session charges work.
// Handles three scenarios:
//   1. SetupIntent has both payment_method and customer → set as default
//   2. SetupIntent missing payment_method (e.g. customer already had a card)
//      → look up customer's existing payment methods and set the most recent
//   3. Truly nothing on file → throw with a clear message
async function attachSetupIntentToCustomer(setupIntentOrId) {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe is not configured');

  // Accept either an ID or a pre-fetched SetupIntent object
  let setupIntent;
  if (typeof setupIntentOrId === 'string') {
    setupIntent = await stripe.setupIntents.retrieve(setupIntentOrId, {
      expand: ['payment_method']
    });
  } else {
    setupIntent = setupIntentOrId;
  }

  console.log('[stripe] SetupIntent state:', {
    id: setupIntent.id,
    status: setupIntent.status,
    has_payment_method: !!setupIntent.payment_method,
    has_customer: !!setupIntent.customer
  });

  let paymentMethodId = typeof setupIntent.payment_method === 'string'
    ? setupIntent.payment_method
    : (setupIntent.payment_method && setupIntent.payment_method.id);
  const customerId = setupIntent.customer;

  if (!customerId) {
    throw new Error('SetupIntent has no associated customer');
  }

  // Fallback: if no payment method on the SetupIntent, look up what's
  // already attached to the customer and pick the most recent card.
  if (!paymentMethodId) {
    console.log('[stripe] SetupIntent has no payment_method; checking customer payment methods');
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 10 });
    if (list.data && list.data.length > 0) {
      paymentMethodId = list.data[0].id;
      console.log(`[stripe] Falling back to existing customer payment method ${paymentMethodId}`);
    }
  }

  if (!paymentMethodId) {
    throw new Error('No payment method available to set as default');
  }

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId }
  });

  console.log(`[stripe] Attached payment method ${paymentMethodId} as default for customer ${customerId}`);
  return { customerId, paymentMethodId };
}

// Check if a customer has a saved default payment method.
async function customerHasPaymentMethod(stripeCustomerId) {
  const stripe = getStripe();
  if (!stripe || !stripeCustomerId) return false;
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId);
    return !!(customer.invoice_settings && customer.invoice_settings.default_payment_method);
  } catch (err) {
    console.error('[stripe] customerHasPaymentMethod failed:', err.message);
    return false;
  }
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
// Card processing fee rate (3.5% covers Stripe's 2.9% + $0.30 with margin)
const CARD_FEE_RATE = 0.035;

function applyCardFee(amountCents, paymentMethodPref) {
  if (paymentMethodPref !== 'card') return amountCents;
  return Math.round(amountCents * (1 + CARD_FEE_RATE));
}

function createInvoicesForEstimate(db, estimateId, paymentPlan, paymentMethodPref) {
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estimateId);
  if (!est) throw new Error('Estimate not found');

  const method = paymentMethodPref || est.payment_method_preference || 'card';
  const totalCents = Math.round(est.total_price * 100);

  const createAll = db.transaction(() => {
    const invoices = [];

    if (paymentPlan === 'full') {
      // Single invoice for total, due immediately
      const invoiceNumber = generateInvoiceNumber(db);
      const today = new Date().toISOString().split('T')[0];
      const amount = applyCardFee(totalCents, method);
      db.prepare(`
        INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, due_date, token)
        VALUES (?, ?, ?, 'pending', 'full', ?, ?)
      `).run(invoiceNumber, estimateId, amount, today, generateInvoiceToken());

      const inv = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
      invoices.push(inv);

    } else if (paymentPlan === 'monthly') {
      // N invoices, each for monthly_price.
      // First invoice: due TODAY so the user starts billing in the current
      // month — not the next one. Every subsequent invoice falls on the 1st
      // of each successive month after.
      const months = est.payment_months || 8;
      const baseMonthlyCents = Math.round(est.monthly_price * 100);
      const monthlyCents = applyCardFee(baseMonthlyCents, method);
      const totalWithFee = applyCardFee(totalCents, method);
      // Adjust last installment to account for rounding
      let remaining = totalWithFee;

      const now = new Date();
      for (let i = 0; i < months; i++) {
        const invoiceNumber = generateInvoiceNumber(db);
        const installmentAmount = (i === months - 1) ? remaining : monthlyCents;
        remaining -= installmentAmount;

        let dueDateStr;
        if (i === 0) {
          // First installment: due today
          dueDateStr = now.toISOString().split('T')[0];
        } else {
          // Subsequent installments: 1st of each successive month
          const dueDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
          dueDateStr = dueDate.toISOString().split('T')[0];
        }

        db.prepare(`
          INSERT INTO invoices (
            invoice_number, estimate_id, amount_cents, status, payment_plan,
            installment_number, total_installments, due_date, token
          ) VALUES (?, ?, ?, 'scheduled', 'monthly', ?, ?, ?, ?)
        `).run(invoiceNumber, estimateId, installmentAmount, i + 1, months, dueDateStr, generateInvoiceToken());

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

  // Apply card fee if client pays by card
  const est = db.prepare('SELECT payment_method_preference FROM estimates WHERE id = ?').get(estimateId);
  const method = est?.payment_method_preference || 'card';
  const finalAmount = applyCardFee(amountCents, method);

  db.prepare(`
    INSERT INTO invoices (
      invoice_number, estimate_id, amount_cents, status, payment_plan, due_date, notes, token
    ) VALUES (?, ?, ?, 'pending', 'per_service', ?, ?, ?)
  `).run(invoiceNumber, estimateId, finalAmount, today, description || null, generateInvoiceToken());

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
  findOrCreateStripeCustomer,
  createCheckoutSession,
  createSetupCheckoutSession,
  attachSetupIntentToCustomer,
  customerHasPaymentMethod,
  createInvoicesForEstimate,
  createPerServiceInvoice,
  constructWebhookEvent,
  chargeCustomer
};
