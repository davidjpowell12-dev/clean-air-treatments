// QuickBooks Online sync — pushes CAT customers, items, and invoices to QBO.
//
// Strategy:
//   • Customer matching: by email (preferred), then DisplayName. qbo_customer_id is
//     cached on the property so we never re-match.
//   • Item matching: by Name (= service.name). qbo_item_id cached on services row.
//   • Invoice line items: derived proportionally from estimate_items so QBO P&L
//     shows revenue broken down by service. Card fee (if any) becomes its own line.
//
// All functions throw on QBO errors so callers can log + show in UI.

const qbo = require('./quickbooks');

const CARD_FEE_RATE = 0.035; // mirror of utils/stripe.js — used to detect fee component

// ─── Income Account ───────────────────────────────────────────
// QBO Items need an IncomeAccountRef. We look up the first
// "ServiceFeeIncome" classification account and cache its ID in
// app_settings. Admins can override by setting the value manually.
async function ensureIncomeAccountId(db) {
  const cached = db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_income_account_id'").get();
  if (cached?.value) return cached.value;

  // Query QBO for service-income accounts. AccountSubType ServiceFeeIncome is most common.
  const query = "SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 10";
  const data = await qbo.qboFetch(db, 'query', { query: { query } });
  const accounts = data?.QueryResponse?.Account || [];
  if (accounts.length === 0) {
    throw new Error('No Income accounts found in QuickBooks. Create one before pushing invoices.');
  }
  // Prefer "Services" by name, otherwise first one.
  const pick = accounts.find(a => /service/i.test(a.Name)) || accounts[0];

  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('qbo_income_account_id', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(pick.Id);
  return pick.Id;
}

// ─── Customer Matching ────────────────────────────────────────
// Properties are the customer-of-record in CAT. We try email first,
// then DisplayName. If neither matches, create. Cache the QBO id.
async function ensureQboCustomer(db, propertyId) {
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!prop) throw new Error(`Property ${propertyId} not found`);
  if (prop.qbo_customer_id) return prop.qbo_customer_id;

  // 1. Try email
  if (prop.email) {
    const emailQ = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${escapeQbo(prop.email)}'`;
    const data = await qbo.qboFetch(db, 'query', { query: { query: emailQ } });
    const match = data?.QueryResponse?.Customer?.[0];
    if (match) {
      db.prepare('UPDATE properties SET qbo_customer_id = ? WHERE id = ?').run(match.Id, propertyId);
      return match.Id;
    }
  }

  // 2. Try DisplayName
  const displayName = makeDisplayName(prop);
  const nameQ = `SELECT * FROM Customer WHERE DisplayName = '${escapeQbo(displayName)}'`;
  const nameData = await qbo.qboFetch(db, 'query', { query: { query: nameQ } });
  const nameMatch = nameData?.QueryResponse?.Customer?.[0];
  if (nameMatch) {
    db.prepare('UPDATE properties SET qbo_customer_id = ? WHERE id = ?').run(nameMatch.Id, propertyId);
    return nameMatch.Id;
  }

  // 3. Create
  const body = {
    DisplayName: displayName,
    ...(prop.email ? { PrimaryEmailAddr: { Address: prop.email } } : {}),
    ...(prop.phone ? { PrimaryPhone: { FreeFormNumber: prop.phone } } : {}),
    ...(prop.address ? {
      BillAddr: {
        Line1: prop.address,
        City: prop.city || undefined,
        CountrySubDivisionCode: prop.state || 'MI',
        PostalCode: prop.zip || undefined
      }
    } : {})
  };
  const created = await qbo.qboFetch(db, 'customer', { method: 'POST', body });
  const newId = created?.Customer?.Id;
  if (!newId) throw new Error('QBO customer creation returned no Id');
  db.prepare('UPDATE properties SET qbo_customer_id = ? WHERE id = ?').run(newId, propertyId);
  return newId;
}

// DisplayName must be unique in QBO. Prefer name; if duplicate-prone, append city.
function makeDisplayName(prop) {
  const name = (prop.customer_name || '').trim();
  if (!name) return `Property #${prop.id}`;
  return prop.city ? `${name} — ${prop.city}` : name;
}

// QBO query strings are single-quoted; escape any embedded apostrophes.
function escapeQbo(str) {
  return String(str).replace(/'/g, "\\'");
}

// ─── Item (Service) Matching ──────────────────────────────────
// Looks up a QBO Item by Name (= service.name). Creates if missing.
// Caches qbo_item_id on the services row.
async function ensureQboItemForService(db, serviceId, serviceName) {
  if (serviceId) {
    const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
    if (svc?.qbo_item_id) return svc.qbo_item_id;
  }

  const incomeAccountId = await ensureIncomeAccountId(db);
  const name = (serviceName || '').slice(0, 100); // QBO Item Name max 100 chars

  // Try existing by Name
  const findQ = `SELECT * FROM Item WHERE Name = '${escapeQbo(name)}'`;
  const data = await qbo.qboFetch(db, 'query', { query: { query: findQ } });
  let item = data?.QueryResponse?.Item?.[0];

  if (!item) {
    const body = {
      Name: name,
      Type: 'Service',
      IncomeAccountRef: { value: incomeAccountId }
    };
    const created = await qbo.qboFetch(db, 'item', { method: 'POST', body });
    item = created?.Item;
    if (!item?.Id) throw new Error(`QBO item creation failed for "${name}"`);
  }

  if (serviceId) {
    db.prepare('UPDATE services SET qbo_item_id = ? WHERE id = ?').run(item.Id, serviceId);
  }
  return item.Id;
}

// Card-fee line uses its own QBO item stored in app_settings.
async function ensureCardFeeItemId(db) {
  const cached = db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_card_fee_item_id'").get();
  if (cached?.value) return cached.value;

  const incomeAccountId = await ensureIncomeAccountId(db);
  const name = 'Card Processing Fee';
  const findQ = `SELECT * FROM Item WHERE Name = '${escapeQbo(name)}'`;
  const data = await qbo.qboFetch(db, 'query', { query: { query: findQ } });
  let item = data?.QueryResponse?.Item?.[0];

  if (!item) {
    const created = await qbo.qboFetch(db, 'item', {
      method: 'POST',
      body: { Name: name, Type: 'Service', IncomeAccountRef: { value: incomeAccountId } }
    });
    item = created?.Item;
    if (!item?.Id) throw new Error('QBO card-fee item creation failed');
  }
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('qbo_card_fee_item_id', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(item.Id);
  return item.Id;
}

// ─── Invoice Line Computation ─────────────────────────────────
// Given an invoice + its parent estimate, return the per-service split
// in CENTS. For monthly: each service = item.price / total_installments.
// For full: each service = item.price. For per_service: single line.
// The card-fee remainder is returned separately.
function computeInvoiceLinesCents(db, invoice, estimate) {
  const items = db.prepare(
    'SELECT * FROM estimate_items WHERE estimate_id = ? AND is_included = 1 ORDER BY sort_order, id'
  ).all(estimate.id);

  // Per-service: one line, just use the invoice's notes as description (set at creation).
  if (invoice.payment_plan === 'per_service') {
    return {
      lines: [{
        service_id: items[0]?.service_id || null,
        service_name: invoice.notes || items[0]?.service_name || 'Service',
        amount_cents: invoice.amount_cents
      }],
      card_fee_cents: 0,
      mode: 'per_service'
    };
  }

  const divisor = invoice.payment_plan === 'monthly'
    ? (invoice.total_installments || estimate.payment_months || 1)
    : 1;

  // Per-service base allocations
  const lines = [];
  let baseSumCents = 0;
  for (const it of items) {
    const cents = Math.round((it.price * 100) / divisor);
    if (cents > 0) {
      lines.push({ service_id: it.service_id, service_name: it.service_name, amount_cents: cents });
      baseSumCents += cents;
    }
  }

  // Card fee = whatever's left between the invoice amount and the base sum.
  // For the LAST installment we may also be absorbing penny rounding from earlier
  // installments, so this can be slightly larger than baseSumCents * CARD_FEE_RATE.
  const remainder = invoice.amount_cents - baseSumCents;

  // Sanity check: if remainder is wildly off (negative or > 50% of base),
  // fall back to a single "Lawn Care Services" line — invoice was probably
  // manually adjusted and proportional split would be wrong.
  if (remainder < -100 || remainder > baseSumCents * 0.5) {
    return {
      lines: [{ service_id: null, service_name: 'Lawn Care Services', amount_cents: invoice.amount_cents }],
      card_fee_cents: 0,
      mode: 'fallback_single_line',
      reason: `unexpected remainder ${remainder} vs base ${baseSumCents}`
    };
  }

  return {
    lines,
    card_fee_cents: Math.max(0, remainder),
    mode: 'split'
  };
}

// ─── Push Invoice to QBO ──────────────────────────────────────
// Main entry point. Idempotent: if the invoice already has qbo_invoice_id
// we skip. Records sync errors on the invoice row.
async function pushInvoiceToQbo(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.qbo_invoice_id) return { skipped: true, qbo_invoice_id: invoice.qbo_invoice_id };
  if (invoice.status === 'voided') return { skipped: true, reason: 'voided' };

  try {
    const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(invoice.estimate_id);
    if (!estimate) throw new Error(`Estimate ${invoice.estimate_id} not found`);
    if (!estimate.property_id) throw new Error('Estimate has no property_id');

    const customerId = await ensureQboCustomer(db, estimate.property_id);
    const { lines, card_fee_cents, mode } = computeInvoiceLinesCents(db, invoice, estimate);

    // Resolve QBO item id for each service line
    const qboLines = [];
    for (const line of lines) {
      const itemId = await ensureQboItemForService(db, line.service_id, line.service_name);
      qboLines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: line.amount_cents / 100,
        Description: line.service_name,
        SalesItemLineDetail: { ItemRef: { value: itemId } }
      });
    }

    // Card fee line, if any
    if (card_fee_cents > 0) {
      const feeItemId = await ensureCardFeeItemId(db);
      qboLines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: card_fee_cents / 100,
        Description: 'Card Processing Fee (3.5%)',
        SalesItemLineDetail: { ItemRef: { value: feeItemId } }
      });
    }

    const body = {
      CustomerRef: { value: customerId },
      DocNumber: invoice.invoice_number,
      TxnDate: invoice.due_date || invoice.created_at?.slice(0, 10),
      DueDate: invoice.due_date || undefined,
      Line: qboLines,
      PrivateNote: `CAT invoice #${invoice.invoice_number} (estimate ${estimate.id})`
    };

    const created = await qbo.qboFetch(db, 'invoice', { method: 'POST', body });
    const qboId = created?.Invoice?.Id;
    if (!qboId) throw new Error('QBO invoice creation returned no Id');

    db.prepare(`
      UPDATE invoices
         SET qbo_invoice_id = ?, qbo_synced_at = CURRENT_TIMESTAMP, qbo_sync_error = NULL
       WHERE id = ?
    `).run(qboId, invoiceId);

    return { success: true, qbo_invoice_id: qboId, mode, line_count: qboLines.length };
  } catch (err) {
    db.prepare('UPDATE invoices SET qbo_sync_error = ? WHERE id = ?').run(String(err.message || err), invoiceId);
    throw err;
  }
}

module.exports = {
  ensureIncomeAccountId,
  ensureQboCustomer,
  ensureQboItemForService,
  ensureCardFeeItemId,
  computeInvoiceLinesCents,
  pushInvoiceToQbo
};
