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

// ─── Generic Service Item ─────────────────────────────────────
// We push every CAT invoice as a single line in QBO using one shared
// "Lawn Care Services" item. The controller asked to keep QBO as pure
// invoicing — revenue breakdowns happen in CAT reports instead.
async function ensureGenericServiceItemId(db) {
  const cached = db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_generic_service_item_id'").get();
  if (cached?.value) {
    // Verify it still exists in QBO (in case the user deleted it manually)
    try {
      const check = await qbo.qboFetch(db, 'item/' + cached.value);
      if (check?.Item?.Id) return cached.value;
    } catch (e) { /* fall through and recreate */ }
  }

  const incomeAccountId = await ensureIncomeAccountId(db);
  const name = 'Lawn Care Services';

  // Try existing by Name first
  const findQ = `SELECT * FROM Item WHERE Name = '${escapeQbo(name)}'`;
  const data = await qbo.qboFetch(db, 'query', { query: { query: findQ } });
  let item = data?.QueryResponse?.Item?.[0];

  if (!item) {
    const created = await qbo.qboFetch(db, 'item', {
      method: 'POST',
      body: { Name: name, Type: 'Service', IncomeAccountRef: { value: incomeAccountId } }
    });
    item = created?.Item;
    if (!item?.Id) throw new Error('QBO item creation failed for Lawn Care Services');
  }

  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('qbo_generic_service_item_id', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(item.Id);
  return item.Id;
}

// ─── Push Invoice to QBO ──────────────────────────────────────
// Single-line invoice push: one line for the full amount using the
// generic Lawn Care Services item. Card fee is baked into the amount
// (that's what the customer was actually billed). Description carries
// the installment context so the controller can see what it covers.
//
// Idempotent: if the invoice already has qbo_invoice_id we skip.
async function pushInvoiceToQbo(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.qbo_invoice_id) return { skipped: true, qbo_invoice_id: invoice.qbo_invoice_id };
  if (invoice.status === 'void' || invoice.status === 'voided') return { skipped: true, reason: 'voided' };

  try {
    const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(invoice.estimate_id);
    if (!estimate) throw new Error(`Estimate ${invoice.estimate_id} not found`);
    if (!estimate.property_id) throw new Error('Estimate has no property_id');

    const customerId = await ensureQboCustomer(db, estimate.property_id);
    const itemId = await ensureGenericServiceItemId(db);

    // Human-readable line description that gives the controller context
    // without exposing per-service splits.
    let description = 'Lawn Care Services';
    if (invoice.payment_plan === 'monthly' && invoice.installment_number && invoice.total_installments) {
      description = `Lawn Care Services — Installment ${invoice.installment_number} of ${invoice.total_installments}`;
    } else if (invoice.payment_plan === 'full') {
      description = 'Lawn Care Services — Pay in Full';
    } else if (invoice.payment_plan === 'per_service' && invoice.notes) {
      description = `Lawn Care Services — ${invoice.notes}`;
    }

    const body = {
      CustomerRef: { value: customerId },
      DocNumber: invoice.invoice_number,
      TxnDate: invoice.due_date || invoice.created_at?.slice(0, 10),
      DueDate: invoice.due_date || undefined,
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: invoice.amount_cents / 100,
        Description: description,
        SalesItemLineDetail: { ItemRef: { value: itemId } }
      }],
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

    return { success: true, qbo_invoice_id: qboId, line_count: 1 };
  } catch (err) {
    db.prepare('UPDATE invoices SET qbo_sync_error = ? WHERE id = ?').run(String(err.message || err), invoiceId);
    throw err;
  }
}

module.exports = {
  ensureIncomeAccountId,
  ensureQboCustomer,
  ensureGenericServiceItemId,
  pushInvoiceToQbo
};
