const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { logAudit } = require('../db/audit');
const { requireAuth } = require('../middleware/auth');
const email = require('../utils/email');

const router = express.Router();

// Helper: get pricing for a sqft value from a service
function getPriceForSqft(db, serviceId, sqft) {
  // Find exact or next-higher tier
  const tier = db.prepare(
    'SELECT price FROM pricing_tiers WHERE service_id = ? AND min_sqft >= ? ORDER BY min_sqft ASC LIMIT 1'
  ).get(serviceId, sqft);
  if (tier) return tier.price;
  // Fallback: highest tier
  const max = db.prepare(
    'SELECT price FROM pricing_tiers WHERE service_id = ? ORDER BY min_sqft DESC LIMIT 1'
  ).get(serviceId);
  return max ? max.price : 0;
}

// List all estimates (with summary)
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const { status } = req.query;

  let sql = `
    SELECT e.*,
      (SELECT COUNT(*) FROM estimate_items WHERE estimate_id = e.id AND is_included = 1) as item_count
    FROM estimates e
  `;
  const params = [];
  if (status) {
    sql += ' WHERE e.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY e.created_at DESC';

  res.json(db.prepare(sql).all(...params));
});

// ─── Public Endpoints (no auth required) ─────────────────────
// These must be defined BEFORE /:id routes to avoid route conflicts

// Public: Get proposal by token (customer-facing)
router.get('/public/:token', (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE token = ?').get(req.params.token);
  if (!est || est.status === 'draft') return res.status(404).json({ error: 'Proposal not found' });

  // Auto-update status from sent → viewed
  if (est.status === 'sent') {
    db.prepare(
      'UPDATE estimates SET status = ?, viewed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run('viewed', new Date().toISOString(), est.id);
    est.status = 'viewed';
    est.viewed_at = new Date().toISOString();
  }

  // Get included items only
  const items = db.prepare(
    'SELECT id, service_name, description, price, is_recurring, rounds, is_included FROM estimate_items WHERE estimate_id = ? AND is_included = 1 ORDER BY sort_order, id'
  ).all(est.id);

  // Return only client-safe fields (strip internal notes, reminder info, etc.)
  res.json({
    id: est.id,
    customer_name: est.customer_name,
    address: est.address,
    city: est.city,
    state: est.state,
    zip: est.zip,
    property_sqft: est.property_sqft,
    total_price: est.total_price,
    monthly_price: est.monthly_price,
    payment_months: est.payment_months,
    status: est.status,
    valid_until: est.valid_until,
    customer_message: est.customer_message,
    accepted_at: est.accepted_at,
    items
  });
});

// Public: Accept proposal by token (with payment plan selection)
router.post('/public/:token/accept', async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE token = ?').get(req.params.token);
  if (!est || est.status === 'draft') return res.status(404).json({ error: 'Proposal not found' });

  if (est.status === 'accepted') {
    // Already accepted — return existing invoices so they can still pay
    const invoices = db.prepare(
      "SELECT id, invoice_number, amount_cents, status, due_date FROM invoices WHERE estimate_id = ? AND status = 'pending' ORDER BY due_date LIMIT 1"
    ).all(est.id);
    return res.json({
      success: true, message: 'Proposal already accepted',
      accepted_at: est.accepted_at, payment_plan: est.payment_plan,
      first_invoice: invoices[0] || null
    });
  }
  if (est.status === 'declined') {
    return res.status(400).json({ error: 'This proposal is no longer available' });
  }

  // Check if expired
  if (est.valid_until) {
    const now = new Date();
    const validUntil = new Date(est.valid_until + 'T23:59:59');
    if (now > validUntil) {
      db.prepare('UPDATE estimates SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('expired', est.id);
      return res.status(400).json({ error: 'This proposal has expired' });
    }
  }

  const paymentPlan = req.body.payment_plan || 'monthly';
  const paymentMethodPref = req.body.payment_method_preference || 'card';
  const excludedItems = Array.isArray(req.body.excluded_items) ? req.body.excluded_items : [];
  const validPlans = ['full', 'monthly', 'per_service'];
  if (!validPlans.includes(paymentPlan)) {
    return res.status(400).json({ error: 'Invalid payment plan' });
  }

  // If client toggled off services, update is_included and recalculate totals
  if (excludedItems.length > 0) {
    const items = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ?').all(est.id);
    // Validate: at least 1 item must stay included
    const remainingCount = items.filter(i => !excludedItems.includes(i.id)).length;
    if (remainingCount === 0) {
      return res.status(400).json({ error: 'At least one service must be selected' });
    }
    // Mark excluded items
    const markExcluded = db.prepare('UPDATE estimate_items SET is_included = 0 WHERE id = ? AND estimate_id = ?');
    for (const itemId of excludedItems) {
      markExcluded.run(itemId, est.id);
    }
    // Recalculate totals from included items
    const includedItems = items.filter(i => !excludedItems.includes(i.id));
    const newTotal = includedItems.reduce((sum, i) => {
      return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
    }, 0);
    const months = est.payment_months || 8;
    const newMonthly = Math.round((newTotal / months) * 100) / 100;
    db.prepare('UPDATE estimates SET total_price = ?, monthly_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(newTotal, newMonthly, est.id);
    // Update local reference so downstream uses correct values
    est.total_price = newTotal;
    est.monthly_price = newMonthly;
    console.log(`[accept] Client excluded ${excludedItems.length} items, recalculated total=$${newTotal}, monthly=$${newMonthly}`);
  }

  console.log('[accept] Starting:', {
    estimate_id: est.id,
    customer: est.customer_name,
    paymentPlan,
    paymentMethodPref,
    excluded_items: excludedItems.length,
    has_email: !!est.email,
    has_property_id: !!est.property_id,
    monthly_price: est.monthly_price,
    total_price: est.total_price,
    payment_months: est.payment_months
  });

  let step = 'init';
  try {
    const acceptedAt = new Date().toISOString();

    // Step 1: Stripe customer
    step = 'stripe_customer';
    const stripeUtils = require('../utils/stripe');
    let stripeCustomerId = null;
    if (stripeUtils.isEnabled() && est.email) {
      try {
        stripeCustomerId = await stripeUtils.createStripeCustomer(
          est.email, est.customer_name,
          { estimate_id: String(est.id) }
        );
        console.log('[accept] stripe customer:', stripeCustomerId);
      } catch (err) {
        console.error('[accept] Stripe customer creation failed (non-fatal):', err.message);
      }
    }

    // Step 2: Auto-create property if needed (de-dupe by address first)
    step = 'auto_create_property';
    let propertyId = est.property_id;
    if (!propertyId && est.customer_name) {
      // Check for existing property by address (case-insensitive)
      if (est.address) {
        const existing = db.prepare(
          'SELECT id FROM properties WHERE LOWER(TRIM(address)) = LOWER(TRIM(?)) LIMIT 1'
        ).get(est.address);
        if (existing) {
          propertyId = existing.id;
          console.log(`[accept] Reusing existing property ${propertyId} for ${est.customer_name} at ${est.address}`);
        }
      }
      if (!propertyId) {
        const result = db.prepare(`
          INSERT INTO properties (customer_name, address, city, state, zip, email, phone, sqft)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          est.customer_name, est.address || '', est.city || '', est.state || 'MI',
          est.zip || '', est.email || '', est.phone || '', est.property_sqft || null
        );
        propertyId = result.lastInsertRowid;
        console.log(`[accept] Auto-created property ${propertyId} for ${est.customer_name}`);
      }
    }

    // Step 3: Update estimate row
    step = 'update_estimate';
    // Detect whether the payment_method_preference column exists (migration 18)
    let hasPmpColumn = true;
    try {
      const cols = db.prepare("PRAGMA table_info(estimates)").all();
      hasPmpColumn = cols.some(c => c.name === 'payment_method_preference');
    } catch (e) { /* ignore */ }

    if (hasPmpColumn) {
      db.prepare(`
        UPDATE estimates SET
          status = 'accepted', accepted_at = ?, payment_plan = ?,
          payment_method_preference = ?, stripe_customer_id = ?, property_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(acceptedAt, paymentPlan, paymentMethodPref, stripeCustomerId, propertyId, est.id);
    } else {
      console.warn('[accept] payment_method_preference column missing, falling back');
      db.prepare(`
        UPDATE estimates SET
          status = 'accepted', accepted_at = ?, payment_plan = ?,
          stripe_customer_id = ?, property_id = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(acceptedAt, paymentPlan, stripeCustomerId, propertyId, est.id);
    }

    // Step 4: Generate invoices
    step = 'create_invoices';
    const invoices = stripeUtils.createInvoicesForEstimate(db, est.id, paymentPlan, paymentMethodPref);
    console.log(`[accept] Created ${invoices.length} invoice(s)`);

    // Step 5: Audit log (non-fatal if it fails)
    step = 'audit_log';
    try {
      logAudit(db, 'estimate', est.id, null, 'accepted_by_customer', {
        customer_name: est.customer_name, payment_plan: paymentPlan,
        invoices_created: invoices.length
      });
    } catch (auditErr) {
      console.error('[accept] audit log failed (non-fatal):', auditErr.message);
    }

    console.log('[accept] SUCCESS for estimate', est.id);
    res.json({
      success: true,
      message: 'Proposal accepted!',
      accepted_at: acceptedAt,
      payment_plan: paymentPlan,
      first_invoice: invoices[0] || null,
      total_invoices: invoices.length
    });
  } catch (err) {
    console.error(`[accept] FAILED at step '${step}' for estimate ${est.id}:`, err && err.stack || err);
    res.status(500).json({
      error: 'Failed to process acceptance. Please try again.',
      debug_step: step,
      debug_message: err && err.message || String(err)
    });
  }
});

// Public: Create Stripe Setup Mode Checkout to securely save a card
// (no charge today). Used after a customer accepts a monthly plan with card.
router.post('/public/:token/setup-card', async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE token = ?').get(req.params.token);
  if (!est) return res.status(404).json({ error: 'Proposal not found' });
  if (est.status !== 'accepted') {
    return res.status(400).json({ error: 'Proposal must be accepted before saving a card' });
  }

  const stripeUtils = require('../utils/stripe');
  if (!stripeUtils.isEnabled()) {
    return res.status(503).json({ error: 'Payments are not configured' });
  }

  try {
    // Reuse existing Stripe customer from estimate, or look up / create one
    let stripeCustomerId = est.stripe_customer_id;
    if (!stripeCustomerId && est.email) {
      stripeCustomerId = await stripeUtils.findOrCreateStripeCustomer(
        est.email, est.customer_name, { estimate_id: String(est.id) }
      );
      db.prepare('UPDATE estimates SET stripe_customer_id = ? WHERE id = ?')
        .run(stripeCustomerId, est.id);
    }

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const baseUrl = `${proto}://${host}`;

    const session = await stripeUtils.createSetupCheckoutSession({
      estimateId: est.id,
      customerName: est.customer_name,
      customerEmail: est.email,
      stripeCustomerId,
      successUrl: `${baseUrl}/proposal/${req.params.token}/card-saved?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/proposal/${req.params.token}?card=cancelled`
    });

    res.json({ success: true, url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[setup-card] Failed:', err && err.stack || err);
    res.status(500).json({ error: 'Could not create card setup session', debug_message: err.message });
  }
});

// Public: Card-saved success page (Stripe redirects here after setup mode)
// Attaches the saved payment method as the customer's default and redirects
// back to the proposal page with a flag so the success state is shown.
router.get('/public/:token/card-saved', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.redirect(`/proposal/${req.params.token}`);

  try {
    const stripeUtils = require('../utils/stripe');
    const stripe = require('stripe')(stripeUtils.getStripeKey());
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.setup_intent) {
      await stripeUtils.attachSetupIntentToCustomer(session.setup_intent);
    }
    res.redirect(`/proposal/${req.params.token}?card=saved`);
  } catch (err) {
    console.error('[card-saved] Failed to attach payment method:', err.message);
    res.redirect(`/proposal/${req.params.token}?card=error`);
  }
});

// Authenticated: regenerate a card-save link for a specific estimate (e.g. for Melissa)
// Returns a URL the user can SMS to a customer who hasn't saved a card yet.
router.post('/:id/card-save-link', requireAuth, async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });
  if (!est.token) return res.status(400).json({ error: 'Estimate has no public token' });

  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const baseUrl = `${proto}://${host}`;

  // The customer flow: open the proposal page; it will detect accepted+no-card
  // and surface a "Save your card" button. For simplicity we just return the
  // proposal URL plus a hint flag.
  const url = `${baseUrl}/proposal/${est.token}?save_card=1`;
  res.json({ success: true, url });
});

// Get accepted estimates that need scheduling (for dashboard widget)
router.get('/needs-scheduling', requireAuth, (req, res) => {
  const db = getDb();
  const estimates = db.prepare(`
    SELECT e.id, e.customer_name, e.address, e.city, e.total_price, e.monthly_price,
           e.payment_months, e.accepted_at, e.property_id,
           (SELECT COUNT(*) FROM estimate_items WHERE estimate_id = e.id AND is_included = 1) as item_count,
           ROUND((julianday('now') - julianday(e.accepted_at))) as days_since_accepted
    FROM estimates e
    WHERE e.status = 'accepted'
      AND e.id NOT IN (SELECT DISTINCT estimate_id FROM schedules WHERE estimate_id IS NOT NULL)
    ORDER BY e.accepted_at ASC
  `).all();
  res.json(estimates);
});

// Get single estimate with items
router.get('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  est.items = db.prepare(
    'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY sort_order, id'
  ).all(est.id);

  res.json(est);
});

// Build estimate for a property — returns services with auto-priced items
// Build estimate for a new lead (no property yet)
router.get('/build/new-lead', requireAuth, (req, res) => {
  const db = getDb();
  const services = db.prepare(
    'SELECT * FROM services WHERE is_active = 1 ORDER BY display_order, id'
  ).all();

  const items = services.map((svc, i) => ({
    service_id: svc.id,
    service_name: svc.name,
    description: svc.description,
    is_recurring: svc.is_recurring,
    rounds: svc.rounds,
    price: 0,
    is_included: 1,
    sort_order: i
  }));

  res.json({ property: null, items });
});

// Build estimate for an existing property
router.get('/build/:propertyId', requireAuth, (req, res) => {
  const db = getDb();
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.propertyId);
  if (!prop) return res.status(404).json({ error: 'Property not found' });

  const services = db.prepare(
    'SELECT * FROM services WHERE is_active = 1 ORDER BY display_order, id'
  ).all();

  const sqft = prop.sqft || 0;
  const items = services.map((svc, i) => ({
    service_id: svc.id,
    service_name: svc.name,
    description: svc.description,
    is_recurring: svc.is_recurring,
    rounds: svc.rounds,
    price: sqft > 0 ? getPriceForSqft(db, svc.id, sqft) : 0,
    is_included: 1,
    sort_order: i
  }));

  res.json({
    property: prop,
    items
  });
});

// Create estimate
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const {
    property_id, customer_name, address, city, state, zip,
    email, phone, property_sqft, payment_months,
    valid_until, notes, customer_message, items
  } = req.body;

  if (!customer_name) return res.status(400).json({ error: 'Customer name required' });
  if (!items || !items.length) return res.status(400).json({ error: 'At least one item required' });

  const months = payment_months || 8;

  const create = db.transaction(() => {
    // Calculate totals from included items
    const includedItems = items.filter(i => i.is_included);
    const totalPrice = includedItems.reduce((sum, i) => {
      return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
    }, 0);
    const monthlyPrice = Math.round((totalPrice / months) * 100) / 100;

    const token = crypto.randomBytes(32).toString('hex');

    const result = db.prepare(`
      INSERT INTO estimates (
        property_id, customer_name, address, city, state, zip,
        email, phone, property_sqft, total_price, monthly_price,
        payment_months, token, valid_until, notes, customer_message, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      property_id || null, customer_name, address, city, state || 'MI', zip,
      email, phone, property_sqft, totalPrice, monthlyPrice,
      months, token, valid_until || null, notes || null, customer_message || null,
      req.session.userId
    );

    const estId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO estimate_items (
        estimate_id, service_id, service_name, description, price,
        is_recurring, rounds, is_included, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      insertItem.run(
        estId, item.service_id || null, item.service_name, item.description || null,
        item.price, item.is_recurring ? 1 : 0, item.rounds || 1,
        item.is_included ? 1 : 0, item.sort_order || 0
      );
    }

    return estId;
  });

  const estId = create();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(estId);
  est.items = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ?').all(estId);

  logAudit(db, 'estimate', estId, req.session.userId, 'create', {
    customer_name, total: est.total_price, items: items.length
  });

  res.json(est);
});

// Update estimate (items, prices, toggles, customer info)
router.put('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Estimate not found' });

  const {
    customer_name, address, city, state, zip, email, phone,
    property_sqft, payment_months, valid_until, notes,
    customer_message, status, items
  } = req.body;

  const months = payment_months || existing.payment_months;

  const update = db.transaction(() => {
    // If items provided, recalculate totals and replace items
    let totalPrice = existing.total_price;
    let monthlyPrice = existing.monthly_price;

    if (items) {
      // Delete existing items and re-insert
      db.prepare('DELETE FROM estimate_items WHERE estimate_id = ?').run(req.params.id);

      const insertItem = db.prepare(`
        INSERT INTO estimate_items (
          estimate_id, service_id, service_name, description, price,
          is_recurring, rounds, is_included, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of items) {
        insertItem.run(
          req.params.id, item.service_id || null, item.service_name,
          item.description || null, item.price,
          item.is_recurring ? 1 : 0, item.rounds || 1,
          item.is_included ? 1 : 0, item.sort_order || 0
        );
      }

      const included = items.filter(i => i.is_included);
      totalPrice = included.reduce((sum, i) => {
        return sum + (i.is_recurring ? i.price * (i.rounds || 1) : i.price);
      }, 0);
      monthlyPrice = Math.round((totalPrice / months) * 100) / 100;
    }

    db.prepare(`
      UPDATE estimates SET
        customer_name = COALESCE(?, customer_name),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        zip = COALESCE(?, zip),
        email = ?,
        phone = ?,
        property_sqft = COALESCE(?, property_sqft),
        total_price = ?,
        monthly_price = ?,
        payment_months = ?,
        valid_until = ?,
        notes = ?,
        customer_message = ?,
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      customer_name || null, address || null, city || null, state || null, zip || null,
      email !== undefined ? email : existing.email,
      phone !== undefined ? phone : existing.phone,
      property_sqft || null, totalPrice, monthlyPrice, months,
      valid_until !== undefined ? valid_until : existing.valid_until,
      notes !== undefined ? notes : existing.notes,
      customer_message !== undefined ? customer_message : existing.customer_message,
      status || null, req.params.id
    );
  });

  update();

  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  est.items = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY sort_order, id').all(req.params.id);

  logAudit(db, 'estimate', req.params.id, req.session.userId, 'update', {
    status: est.status, total: est.total_price
  });

  res.json(est);
});

// Toggle a single item's included status
router.put('/:id/items/:itemId/toggle', requireAuth, (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM estimate_items WHERE id = ? AND estimate_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const newIncluded = item.is_included ? 0 : 1;
  db.prepare('UPDATE estimate_items SET is_included = ? WHERE id = ?').run(newIncluded, item.id);

  // Recalculate totals
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  const allItems = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ?').all(req.params.id);
  const included = allItems.filter(i => i.is_included);
  const totalPrice = included.reduce((sum, i) => {
    return sum + (i.is_recurring ? i.price * i.rounds : i.price);
  }, 0);
  const monthlyPrice = Math.round((totalPrice / est.payment_months) * 100) / 100;

  db.prepare('UPDATE estimates SET total_price = ?, monthly_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(totalPrice, monthlyPrice, req.params.id);

  res.json({ is_included: newIncluded, total_price: totalPrice, monthly_price: monthlyPrice });
});

// Send estimate to customer via email
router.post('/:id/send', requireAuth, async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const toEmail = req.body.email || est.email;
  if (!toEmail) return res.status(400).json({ error: 'Customer email is required' });

  // Ensure token exists
  if (!est.token) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE estimates SET token = ? WHERE id = ?').run(token, est.id);
    est.token = token;
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const proposalUrl = `${baseUrl}/proposal/${est.token}`;

  try {
    await email.sendProposalEmail({
      to: toEmail,
      customerName: est.customer_name,
      monthlyPrice: est.monthly_price,
      totalPrice: est.total_price,
      paymentMonths: est.payment_months,
      proposalUrl,
      validUntil: est.valid_until
    });

    // Update status to sent + save the email we sent to
    db.prepare(`
      UPDATE estimates SET status = 'sent', sent_at = ?, email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(new Date().toISOString(), toEmail, est.id);

    logAudit(db, 'estimate', est.id, req.session.userId, 'sent_email', {
      to: toEmail, customer_name: est.customer_name
    });

    const updated = db.prepare('SELECT * FROM estimates WHERE id = ?').get(est.id);
    res.json({ success: true, message: `Proposal sent to ${toEmail}`, estimate: updated });
  } catch (err) {
    console.error('[email] Send failed:', err.message);
    res.status(500).json({ error: 'Failed to send email. ' + (err.message || 'Check email configuration.') });
  }
});

// Send estimate via SMS (generates token, marks as sent, returns proposal URL)
router.post('/:id/send-sms', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const phone = req.body.phone;
  if (!phone) return res.status(400).json({ error: 'Phone number is required' });

  // Ensure token exists
  if (!est.token) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE estimates SET token = ? WHERE id = ?').run(token, est.id);
    est.token = token;
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const proposalUrl = `${baseUrl}/proposal/${est.token}`;

  // Update status to sent + save phone
  db.prepare(`
    UPDATE estimates SET status = 'sent', sent_at = CURRENT_TIMESTAMP, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(phone, est.id);

  logAudit(db, 'estimate', est.id, req.session.userId, 'sent_sms', {
    phone, customer_name: est.customer_name
  });

  res.json({
    success: true,
    proposal_url: proposalUrl,
    customer_name: est.customer_name,
    monthly_price: est.monthly_price
  });
});

// Track SMS reminder sent
router.post('/:id/send-reminder-sms', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  db.prepare(`
    UPDATE estimates SET
      last_reminder_at = CURRENT_TIMESTAMP,
      reminder_count = reminder_count + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(est.id);

  logAudit(db, 'estimate', est.id, req.session.userId, 'reminder_sms', {
    phone: est.phone, reminder_number: est.reminder_count + 1
  });

  res.json({ success: true });
});

// Send reminder email for an estimate
router.post('/:id/send-reminder', requireAuth, async (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });
  if (!est.email) return res.status(400).json({ error: 'No customer email on this estimate' });
  if (est.status !== 'sent' && est.status !== 'viewed') {
    return res.status(400).json({ error: 'Can only send reminders for sent/viewed estimates' });
  }

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const proposalUrl = `${baseUrl}/proposal/${est.token}`;

  try {
    await email.sendReminderEmail({
      to: est.email,
      customerName: est.customer_name,
      monthlyPrice: est.monthly_price,
      totalPrice: est.total_price,
      paymentMonths: est.payment_months,
      proposalUrl,
      reminderNumber: est.reminder_count + 1
    });

    db.prepare(`
      UPDATE estimates SET
        last_reminder_at = CURRENT_TIMESTAMP,
        reminder_count = reminder_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(est.id);

    logAudit(db, 'estimate', est.id, req.session.userId, 'reminder_sent', {
      to: est.email, reminder_number: est.reminder_count + 1
    });

    const updated = db.prepare('SELECT * FROM estimates WHERE id = ?').get(est.id);
    res.json({ success: true, message: `Reminder sent to ${est.email}`, estimate: updated });
  } catch (err) {
    console.error('[email] Reminder failed:', err.message);
    res.status(500).json({ error: 'Failed to send reminder. ' + (err.message || 'Check email configuration.') });
  }
});

// Check if email is configured
router.get('/config/email-status', requireAuth, (req, res) => {
  res.json({ enabled: email.isEnabled() });
});

// Delete estimate
router.delete('/:id', requireAuth, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Estimate not found' });

  // Delete related invoices and estimate items first (FK constraints)
  db.prepare('DELETE FROM invoices WHERE estimate_id = ?').run(req.params.id);
  db.prepare('DELETE FROM estimate_items WHERE estimate_id = ?').run(req.params.id);
  db.prepare('DELETE FROM estimates WHERE id = ?').run(req.params.id);
  logAudit(db, 'estimate', req.params.id, req.session.userId, 'delete', existing);
  res.json({ success: true });
});

// Update estimate status (send, mark viewed, accept, decline)
router.put('/:id/status', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const { status } = req.body;
  const validStatuses = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });

  // Ensure token exists when marking as sent (safety net for pre-migration estimates)
  if (status === 'sent' && !est.token) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('UPDATE estimates SET token = ? WHERE id = ?').run(token, est.id);
  }

  const timestamps = {};
  if (status === 'sent') timestamps.sent_at = new Date().toISOString();
  if (status === 'viewed') timestamps.viewed_at = new Date().toISOString();
  if (status === 'accepted') timestamps.accepted_at = new Date().toISOString();
  if (status === 'declined') timestamps.declined_at = new Date().toISOString();

  let sql = 'UPDATE estimates SET status = ?, updated_at = CURRENT_TIMESTAMP';
  const params = [status];

  for (const [col, val] of Object.entries(timestamps)) {
    sql += `, ${col} = ?`;
    params.push(val);
  }

  sql += ' WHERE id = ?';
  params.push(req.params.id);
  db.prepare(sql).run(...params);

  logAudit(db, 'estimate', req.params.id, req.session.userId, 'status_change', {
    from: est.status, to: status
  });

  const updated = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Get estimates that need reminders (sent > 24h ago, no response, under max reminders)
router.get('/reminders/pending', requireAuth, (req, res) => {
  const db = getDb();
  const estimates = db.prepare(`
    SELECT e.*,
      COALESCE(e.last_reminder_at, e.sent_at) as last_contact_at
    FROM estimates e
    WHERE e.status = 'sent'
      AND e.reminder_count < e.max_reminders
      AND (
        (e.last_reminder_at IS NULL AND e.sent_at <= datetime('now', '-1 day'))
        OR (e.last_reminder_at IS NOT NULL AND e.last_reminder_at <= datetime('now', '-1 day'))
      )
    ORDER BY e.sent_at ASC
  `).all();

  res.json(estimates);
});

// Schedule job from accepted estimate — creates per-service schedule entries
router.post('/:id/schedule', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });
  if (est.status !== 'accepted') return res.status(400).json({ error: 'Only accepted estimates can be scheduled' });

  if (!est.property_id) {
    return res.status(400).json({ error: 'Estimate has no linked property. Edit the estimate first.' });
  }

  const { services, one_time_services, assigned_to } = req.body;

  // Support legacy single-interval format
  if (!services && req.body.start_date) {
    const interval = req.body.interval_weeks || 5;
    const items = db.prepare('SELECT * FROM estimate_items WHERE estimate_id = ? AND is_included = 1').all(est.id);
    const recurringItems = items.filter(i => i.is_recurring);
    const totalRounds = recurringItems.length > 0 ? Math.max(...recurringItems.map(i => i.rounds || 1)) : 1;
    const programId = `est_${est.id}_${Date.now()}`;
    const created = db.transaction(() => {
      const c = [];
      for (let round = 1; round <= totalRounds; round++) {
        const offsetDays = (round - 1) * interval * 7;
        const roundDate = db.prepare("SELECT date(?, '+' || ? || ' days') as d").get(req.body.start_date, offsetDays);
        const result = db.prepare(`INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, round_number, total_rounds, program_id, estimate_id, created_by) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`)
          .run(est.property_id, roundDate.d, assigned_to || null, round, totalRounds, programId, est.id, req.session.userId);
        c.push({ id: result.lastInsertRowid, round, date: roundDate.d });
      }
      return c;
    })();
    return res.json({ success: true, total_created: created.length, entries: created });
  }

  const programId = `est_${est.id}_${Date.now()}`;

  const allCreated = db.transaction(() => {
    const created = [];

    // Schedule recurring services — each gets its own entries
    if (services && services.length > 0) {
      for (const svc of services) {
        const rounds = svc.rounds || 6;
        const interval = svc.interval_weeks || 5;
        const startDate = svc.start_date;
        if (!startDate) continue;

        for (let round = 1; round <= rounds; round++) {
          const offsetDays = (round - 1) * interval * 7;
          const roundDate = db.prepare("SELECT date(?, '+' || ? || ' days') as d").get(startDate, offsetDays);

          const result = db.prepare(`
            INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, round_number, total_rounds, program_id, estimate_id, service_type, created_by)
            VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
          `).run(
            est.property_id, roundDate.d, assigned_to || null,
            round, rounds, programId, est.id,
            svc.service_name, req.session.userId
          );

          created.push({ id: result.lastInsertRowid, service: svc.service_name, round, date: roundDate.d });
        }
      }
    }

    // Schedule one-time services
    if (one_time_services && one_time_services.length > 0) {
      for (const ot of one_time_services) {
        if (!ot.date) continue;
        const serviceLabel = (ot.service_names || []).join(', ');

        const result = db.prepare(`
          INSERT INTO schedules (property_id, scheduled_date, assigned_to, sort_order, round_number, total_rounds, program_id, estimate_id, service_type, created_by)
          VALUES (?, ?, ?, 0, 1, 1, ?, ?, ?, ?)
        `).run(
          est.property_id, ot.date, assigned_to || null,
          programId, est.id, serviceLabel, req.session.userId
        );

        created.push({ id: result.lastInsertRowid, service: serviceLabel, round: 1, date: ot.date });
      }
    }

    return created;
  })();

  logAudit(db, 'schedule', 0, req.session.userId, 'schedule_from_estimate', {
    estimate_id: est.id, customer_name: est.customer_name,
    total_created: allCreated.length, program_id: programId
  });

  res.json({
    success: true,
    total_created: allCreated.length,
    entries: allCreated,
    program_id: programId
  });
});

// Mark a reminder as sent for an estimate
router.post('/:id/reminder-sent', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  db.prepare(`
    UPDATE estimates SET
      last_reminder_at = CURRENT_TIMESTAMP,
      reminder_count = reminder_count + 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(req.params.id);

  logAudit(db, 'estimate', req.params.id, req.session.userId, 'reminder_sent', {
    reminder_number: est.reminder_count + 1
  });

  const updated = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// Cancel job — decline estimate and remove all linked schedule entries
router.post('/:id/cancel', requireAuth, (req, res) => {
  const db = getDb();
  const est = db.prepare('SELECT * FROM estimates WHERE id = ?').get(req.params.id);
  if (!est) return res.status(404).json({ error: 'Estimate not found' });

  const result = db.transaction(() => {
    // Remove all non-completed schedule entries linked to this estimate
    const removed = db.prepare(
      "DELETE FROM schedules WHERE estimate_id = ? AND status != 'completed'"
    ).run(est.id);

    // Mark estimate as declined
    db.prepare(
      "UPDATE estimates SET status = 'declined', declined_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(est.id);

    return removed.changes;
  })();

  logAudit(db, 'estimate', est.id, req.session.userId, 'job_cancelled', {
    customer_name: est.customer_name,
    schedule_entries_removed: result
  });

  res.json({ success: true, removed_count: result });
});

module.exports = router;
