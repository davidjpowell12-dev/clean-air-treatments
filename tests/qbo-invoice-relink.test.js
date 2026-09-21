// A paid invoice's QuickBooks link must point at THAT invoice before the
// payment step trusts it.
//
// Reported: CA-2026-0993 was linked to QBO #146 (a journal entry) and
// CA-2026-1009 to #147 (unreadable), while their real invoices — #4480 and
// #4503 — sat in QuickBooks fully paid.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');
const qbo = require('../utils/quickbooks');

const loadSync = () => {
  delete require.cache[require.resolve('../utils/quickbooks-sync')];
  return require('../utils/quickbooks-sync');
};

let qboInvoices, payments, calls;
beforeEach(() => {
  qboInvoices = {}; payments = []; calls = [];
  qbo.qboFetch = async (db, path, opts = {}) => {
    calls.push(opts.method ? `${opts.method} ${path}` : path);
    if (path.startsWith('invoice/')) {
      const id = path.split('/')[1];
      if (id === '146') throw new Error('QBO API GET invoice/146 failed (400): {"Fault":{"Error":[{"Message":"Object Not Found","Detail":"Object Not Found : TxnType does not match read: Journal Entry expected: Invoice"}]}}');
      if (id === '147') throw new Error('QBO API GET invoice/147 failed (400): {"Fault":{"Error":[{"Detail":"Something you\'re trying to use has been made inactive."}]}}');
      if (!qboInvoices[id]) throw new Error(`QBO API GET invoice/${id} failed (400): Object Not Found`);
      return { Invoice: qboInvoices[id] };
    }
    if (path === 'query') {
      const doc = (opts.query.query.match(/DocNumber = '([^']+)'/) || [])[1];
      return { QueryResponse: { Invoice: Object.values(qboInvoices).filter(i => i.DocNumber === doc) } };
    }
    if (path.startsWith('customer/')) return { Customer: { Id: '223', Active: true } };
    if (path === 'payment' && opts.method === 'POST') {
      payments.push(opts.body);
      return { Payment: { Id: 'P' + payments.length } };
    }
    throw new Error('unexpected QBO call ' + path);
  };
});

function paidInvoice(db, number, qboId, cents = 9056) {
  const prop = addProperty(db, 'Joe Uhl');
  db.prepare("UPDATE properties SET qbo_customer_id = '223' WHERE id = ?").run(prop);
  const est = addEstimate(db, { propertyId: prop, name: 'Joe Uhl' });
  const r = db.prepare(`INSERT INTO invoices (invoice_number, estimate_id, amount_cents, status, payment_plan, qbo_invoice_id, payment_method, paid_at)
                        VALUES (?, ?, ?, 'paid', 'monthly', ?, 'card', '2026-05-13T12:00:00Z')`).run(number, est, cents, qboId);
  return r.lastInsertRowid;
}
const row = (db, id) => db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);

test('reported case 1: linked to a journal entry → relinked to the real paid invoice, nothing sent', async () => {
  qboInvoices['4480'] = { Id: '4480', DocNumber: 'CA-2026-0993', Balance: 0, CustomerRef: { name: 'Joe Uhl' } };
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-0993', '146');

  const r = await loadSync().recordPaymentInQbo(db, id);
  assert.equal(r.reason, 'already paid in QBO');
  assert.equal(payments.length, 0, 'no duplicate payment');
  assert.equal(row(db, id).qbo_invoice_id, '4480', 'link corrected');
  assert.ok(row(db, id).qbo_payment_synced_at, 'marked done, so it stops reappearing');
  assert.equal(row(db, id).qbo_sync_error, null);
});

test('reported case 2: linked to an unreadable record → relinked to the real paid invoice', async () => {
  qboInvoices['4503'] = { Id: '4503', DocNumber: 'CA-2026-1009', Balance: 0, CustomerRef: { name: 'Marie Russo' } };
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-1009', '147', 67800);

  const r = await loadSync().recordPaymentInQbo(db, id);
  assert.equal(r.reason, 'already paid in QBO');
  assert.equal(payments.length, 0);
  assert.equal(row(db, id).qbo_invoice_id, '4503');
});

test("a link to SOMEONE ELSE'S paid invoice is not trusted as proof this one is paid", async () => {
  qboInvoices['200'] = { Id: '200', DocNumber: '147', Balance: 0, CustomerRef: { name: 'Leslie VanDusen' } };
  qboInvoices['4600'] = { Id: '4600', DocNumber: 'CA-2026-2000', Balance: 90.56, CustomerRef: { name: 'Joe Uhl' } };
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-2000', '200');

  const r = await loadSync().recordPaymentInQbo(db, id);
  assert.equal(r.success, true, "Leslie's $0 balance did not count as Joe's payment");
  assert.equal(payments.length, 1);
  assert.equal(payments[0].Line[0].LinkedTxn[0].TxnId, '4600', "the payment went to Joe's invoice, not Leslie's");
});

test('a correct link is used as-is — no extra lookups', async () => {
  qboInvoices['4480'] = { Id: '4480', DocNumber: 'CA-2026-0993', Balance: 90.56 };
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-0993', '4480');

  await loadSync().recordPaymentInQbo(db, id);
  assert.ok(!calls.includes('query'), 'did not search for a replacement');
  assert.equal(payments[0].Line[0].LinkedTxn[0].TxnId, '4480');
});

test('bad link and no invoice with this number → stops and explains, sends nothing, keeps the link', async () => {
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-0993', '146'); // journal entry, and no CA-2026-0993 in QBO

  await assert.rejects(loadSync().recordPaymentInQbo(db, id), /already entered in QuickBooks some other way/);
  assert.equal(payments.length, 0, 'no fresh push that could double-count a hand-entered journal entry');
  assert.equal(row(db, id).qbo_invoice_id, '146', 'link left for a human to look at');
  assert.equal(row(db, id).qbo_payment_synced_at, null, 'still listed as needing attention');
  assert.match(row(db, id).qbo_sync_error, /journal|different kind|some other way/i);
});

test('two QuickBooks invoices with the same number → stops rather than picking one', async () => {
  qboInvoices['5000'] = { Id: '5000', DocNumber: 'CA-2026-0993', Balance: 0 };
  qboInvoices['5001'] = { Id: '5001', DocNumber: 'CA-2026-0993', Balance: 0 };
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-0993', '146');

  await assert.rejects(loadSync().recordPaymentInQbo(db, id), /2 invoices numbered CA-2026-0993/);
  assert.equal(payments.length, 0);
});

test('an auth failure is not mistaken for a bad link', async () => {
  qbo.qboFetch = async () => { throw new Error('QBO refresh failed (401): invalid_grant'); };
  const db = makeDb();
  const id = paidInvoice(db, 'CA-2026-0993', '4480');

  await assert.rejects(loadSync().recordPaymentInQbo(db, id), /invalid_grant/);
  assert.equal(row(db, id).qbo_invoice_id, '4480', 'good link untouched');
});
