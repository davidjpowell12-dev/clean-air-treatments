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
//
// The cached id is re-checked before use. It used to be trusted forever, so
// when a duplicate customer was deactivated or merged away during QuickBooks
// cleanup, every later invoice for that person was sent to the dead record
// and QBO refused it ("Something you're trying to use has been made
// inactive") — while the real, active customer sat unused. A stale id is now
// dropped and the lookup below finds the active customer. Checks are
// remembered for a few minutes so a bulk sync doesn't re-check the same
// customer for every installment.
const _verifiedCustomers = new Map(); // qbo customer id -> time verified active
const CUSTOMER_VERIFY_TTL_MS = 10 * 60 * 1000;

async function isQboCustomerUsable(db, qboCustomerId) {
  const seen = _verifiedCustomers.get(qboCustomerId);
  if (seen && Date.now() - seen < CUSTOMER_VERIFY_TTL_MS) return true;
  try {
    const data = await qbo.qboFetch(db, 'customer/' + qboCustomerId);
    const active = !!data?.Customer && data.Customer.Active !== false;
    if (active) _verifiedCustomers.set(qboCustomerId, Date.now());
    return active;
  } catch (err) {
    // Only "this record is gone/inactive" means stale. Anything else (auth,
    // network, rate limit) must surface, not trigger a re-match.
    if (/Object Not Found|inactive/i.test(err.message || '')) return false;
    throw err;
  }
}

async function ensureQboCustomer(db, propertyId) {
  const prop = db.prepare('SELECT * FROM properties WHERE id = ?').get(propertyId);
  if (!prop) throw new Error(`Property ${propertyId} not found`);
  if (prop.qbo_customer_id) {
    if (await isQboCustomerUsable(db, prop.qbo_customer_id)) return prop.qbo_customer_id;
    console.warn(`[qbo-sync] Property ${propertyId} (${prop.customer_name}) was linked to inactive/missing QBO customer ${prop.qbo_customer_id} — re-matching`);
    db.prepare('UPDATE properties SET qbo_customer_id = NULL WHERE id = ?').run(propertyId);
  }

  // 1. Try email
  if (prop.email) {
    // Active = true is explicit so a re-match can never land back on the
    // deactivated duplicate that caused it.
    const emailQ = `SELECT * FROM Customer WHERE PrimaryEmailAddr = '${escapeQbo(prop.email)}' AND Active = true`;
    const data = await qbo.qboFetch(db, 'query', { query: { query: emailQ } });
    const match = data?.QueryResponse?.Customer?.[0];
    if (match) {
      db.prepare('UPDATE properties SET qbo_customer_id = ? WHERE id = ?').run(match.Id, propertyId);
      return match.Id;
    }
  }

  // 2. Try DisplayName
  const displayName = makeDisplayName(prop);
  const nameQ = `SELECT * FROM Customer WHERE DisplayName = '${escapeQbo(displayName)}' AND Active = true`;
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

// ─── Record Payment in QBO ─────────────────────────────────────
// Once a paid CAT invoice exists in QBO (has qbo_invoice_id), we record a
// QBO Payment linked to it so QBO shows the invoice as Paid. We omit
// DepositToAccountRef so the payment lands in Undeposited Funds (QBO's
// standard holding account); the controller clears those in batches that
// match real Stripe payouts / check deposits.
//
// PaymentRefNum carries the Stripe payment-intent id (card) or check number
// (check). QBO caps PaymentRefNum at 21 chars, so we truncate and keep the
// full reference in PrivateNote.
//
// Safety: before applying a payment we fetch the QBO invoice and check its
// Balance. If it's already 0 (e.g. the payment was recorded manually in QBO),
// we skip — applying another payment would double-pay the invoice.
//
// Idempotent: if the invoice already has qbo_payment_id we skip.
// ─── Invoice link check ───────────────────────────────────────
// Returns the QBO Invoice that really is this app invoice, correcting the
// stored link if it pointed somewhere else.
//
// Every invoice the app pushes carries the app's number as its DocNumber, so
// that's the proof of identity. Two paid invoices were found linked to the
// wrong QuickBooks records (a journal entry, and an unreadable record) while
// their real invoices sat in QBO fully paid. Worse, the balance check below
// used to trust whatever the link pointed at — a link to someone else's paid
// invoice would have marked this one "already paid" and skipped it, or
// applied a payment to the wrong customer's invoice.
//
// Only an unambiguous match is fixed automatically. If there's no invoice
// with this number, or more than one, it stops with an explanation rather
// than re-sending, because a hand-entered record (like a journal entry) may
// already account for the money and a fresh push would double-count it.
async function resolveLinkedQboInvoice(db, invoice) {
  let linkProblem = null;
  if (invoice.qbo_invoice_id) {
    try {
      const data = await qbo.qboFetch(db, 'invoice/' + invoice.qbo_invoice_id);
      const linked = data?.Invoice;
      if (linked && linked.DocNumber === invoice.invoice_number) return linked;
      linkProblem = linked
        ? `is QuickBooks invoice ${linked.DocNumber || '(no number)'} for ${linked.CustomerRef?.name || 'another customer'}`
        : 'is not an invoice';
    } catch (err) {
      const m = err.message || '';
      // Only "this record isn't usable as this invoice" is a link problem;
      // auth/network/rate-limit errors must surface unchanged.
      if (!/Object Not Found|TxnType does not match|inactive/i.test(m)) throw err;
      linkProblem = /TxnType does not match/i.test(m) ? 'is not an invoice (a different kind of transaction)' : "can't be read";
    }
  }

  const q = `SELECT * FROM Invoice WHERE DocNumber = '${escapeQbo(invoice.invoice_number)}'`;
  const found = (await qbo.qboFetch(db, 'query', { query: { query: q } }))?.QueryResponse?.Invoice || [];

  if (found.length === 1) {
    const match = found[0];
    if (String(match.Id) !== String(invoice.qbo_invoice_id)) {
      console.warn(`[qbo-sync] ${invoice.invoice_number}: link to QBO #${invoice.qbo_invoice_id} ${linkProblem || 'was missing'}; relinking to QBO #${match.Id}`);
      db.prepare('UPDATE invoices SET qbo_invoice_id = ? WHERE id = ?').run(match.Id, invoice.id);
      invoice.qbo_invoice_id = match.Id;
    }
    return match;
  }
  if (found.length > 1) {
    throw new Error(`QuickBooks has ${found.length} invoices numbered ${invoice.invoice_number}. Delete or void the duplicate in QuickBooks, then sync again.`);
  }
  throw new Error(`Linked QuickBooks record #${invoice.qbo_invoice_id} ${linkProblem || 'is missing'}, and there's no QuickBooks invoice numbered ${invoice.invoice_number}. `
    + `Check whether this payment was already entered in QuickBooks some other way before re-sending it.`);
}

async function recordPaymentInQbo(db, invoiceId) {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.status !== 'paid') return { skipped: true, reason: 'not paid' };
  if (!invoice.qbo_invoice_id) throw new Error(`Invoice ${invoiceId} has no qbo_invoice_id — push the invoice first`);
  if (invoice.qbo_payment_id) return { skipped: true, qbo_payment_id: invoice.qbo_payment_id };
  // Already processed (either paid via this sync, or detected as already paid
  // in QBO and intentionally skipped). qbo_payment_synced_at is the canonical
  // "done" marker; bail before making any QBO calls.
  if (invoice.qbo_payment_synced_at) return { skipped: true, reason: 'already synced' };

  try {
    // Guard against double-paying an invoice already settled in QBO — using
    // the invoice that is verifiably this one, not merely what the link says.
    const qboInvoice = await resolveLinkedQboInvoice(db, invoice);
    const balance = qboInvoice?.Balance;
    if (balance !== undefined && balance <= 0) {
      db.prepare(`
        UPDATE invoices SET qbo_payment_synced_at = CURRENT_TIMESTAMP, qbo_sync_error = NULL WHERE id = ?
      `).run(invoiceId);
      return { skipped: true, reason: 'already paid in QBO' };
    }

    const estimate = db.prepare('SELECT * FROM estimates WHERE id = ?').get(invoice.estimate_id);
    if (!estimate?.property_id) throw new Error('Estimate/property missing for payment');
    const customerId = await ensureQboCustomer(db, estimate.property_id);

    // Reference string: check number for checks, Stripe pi for cards.
    const fullRef = invoice.payment_method === 'check'
      ? (invoice.check_number ? `Check #${invoice.check_number}` : '')
      : (invoice.stripe_payment_intent_id || '');
    const refNum = fullRef.slice(0, 21); // QBO PaymentRefNum max length

    // Payment date: prefer paid_at, fall back to check_date, then today.
    const txnDate = (invoice.paid_at || invoice.check_date || new Date().toISOString()).slice(0, 10);

    const body = {
      CustomerRef: { value: customerId },
      TotalAmt: invoice.amount_cents / 100,
      TxnDate: txnDate,
      ...(refNum ? { PaymentRefNum: refNum } : {}),
      Line: [{
        Amount: invoice.amount_cents / 100,
        LinkedTxn: [{ TxnId: String(invoice.qbo_invoice_id), TxnType: 'Invoice' }]
      }],
      PrivateNote: `CAT payment for invoice #${invoice.invoice_number}`
        + (fullRef ? ` — ${fullRef}` : '')
        + ` (${invoice.payment_method || 'unknown'})`
    };

    const created = await qbo.qboFetch(db, 'payment', { method: 'POST', body });
    const paymentId = created?.Payment?.Id;
    if (!paymentId) throw new Error('QBO payment creation returned no Id');

    db.prepare(`
      UPDATE invoices
         SET qbo_payment_id = ?, qbo_payment_synced_at = CURRENT_TIMESTAMP, qbo_sync_error = NULL
       WHERE id = ?
    `).run(paymentId, invoiceId);

    return { success: true, qbo_payment_id: paymentId };
  } catch (err) {
    db.prepare('UPDATE invoices SET qbo_sync_error = ? WHERE id = ?').run(String(err.message || err), invoiceId);
    throw err;
  }
}

// ─── Combined: push invoice + record payment ───────────────────
// For a paid CAT invoice this lands a fully-paid invoice in QBO in one call:
// pushes the invoice (if needed) then applies the payment (if needed). For an
// unpaid invoice it just pushes the open invoice (no payment recorded).
async function syncPaidInvoiceToQbo(db, invoiceId) {
  const invoiceResult = await pushInvoiceToQbo(db, invoiceId);
  const invoice = db.prepare('SELECT status FROM invoices WHERE id = ?').get(invoiceId);
  let paymentResult = { skipped: true, reason: 'not paid' };
  if (invoice && invoice.status === 'paid') {
    paymentResult = await recordPaymentInQbo(db, invoiceId);
  }
  return { invoice: invoiceResult, payment: paymentResult };
}

module.exports = {
  ensureIncomeAccountId,
  ensureQboCustomer,
  ensureGenericServiceItemId,
  pushInvoiceToQbo,
  recordPaymentInQbo,
  syncPaidInvoiceToQbo
};
