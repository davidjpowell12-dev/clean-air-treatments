// A property's cached QuickBooks customer id must not outlive the customer.
//
// Reported case: Joe Uhl's invoices failed with "Something you're trying to
// use has been made inactive" while Joe Uhl (#223) was active in QuickBooks.
// The app had cached a duplicate Joe Uhl that was later deactivated during
// QuickBooks cleanup, and kept sending invoices to it.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty } = require('./helpers');
const qbo = require('../utils/quickbooks');

// Fresh module each test so the "recently verified" memo doesn't leak between tests.
const loadSync = () => {
  delete require.cache[require.resolve('../utils/quickbooks-sync')];
  return require('../utils/quickbooks-sync');
};

// Fake QuickBooks: a customer table, plus a log of every call.
let customers, calls;
beforeEach(() => {
  calls = [];
  customers = {};
  qbo.qboFetch = async (db, path, opts = {}) => {
    calls.push(path);
    if (path.startsWith('customer/')) {
      const c = customers[path.split('/')[1]];
      if (!c) throw new Error(`QBO API GET ${path} failed (400): {"Fault":{"Error":[{"Message":"Object Not Found"}]}}`);
      return { Customer: c };
    }
    if (path === 'query') {
      const q = opts.query.query;
      const email = (q.match(/PrimaryEmailAddr = '([^']+)'/) || [])[1];
      const name = (q.match(/DisplayName = '([^']+)'/) || [])[1];
      const activeOnly = /Active = true/.test(q);
      const hits = Object.values(customers).filter(c =>
        (!activeOnly || c.Active !== false) &&
        ((email && c.PrimaryEmailAddr?.Address === email) || (name && c.DisplayName === name)));
      return { QueryResponse: { Customer: hits } };
    }
    if (path === 'customer' && opts.method === 'POST') {
      const id = String(900 + Object.keys(customers).length);
      customers[id] = { Id: id, ...opts.body, Active: true };
      return { Customer: customers[id] };
    }
    throw new Error('unexpected QBO call ' + path);
  };
});

function joe(db, cachedId) {
  const id = addProperty(db, 'Joe Uhl');
  db.prepare('UPDATE properties SET email = ?, qbo_customer_id = ? WHERE id = ?').run('joeguhl@gmail.com', cachedId, id);
  return id;
}

test('the reported case: cached id points at a deactivated duplicate → relinks to the active customer', async () => {
  customers['150'] = { Id: '150', DisplayName: 'Joe Uhl (deleted)', PrimaryEmailAddr: { Address: 'joeguhl@gmail.com' }, Active: false };
  customers['223'] = { Id: '223', DisplayName: 'Joe Uhl', PrimaryEmailAddr: { Address: 'joeguhl@gmail.com' }, Active: true };
  const db = makeDb();
  const prop = joe(db, '150');

  const id = await loadSync().ensureQboCustomer(db, prop);
  assert.equal(id, '223', 'uses the active Joe Uhl, not the deactivated duplicate with the same email');
  assert.equal(db.prepare('SELECT qbo_customer_id FROM properties WHERE id = ?').get(prop).qbo_customer_id, '223', 'and remembers it');
});

test('a cached customer that no longer exists at all is also relinked', async () => {
  customers['223'] = { Id: '223', DisplayName: 'Joe Uhl', PrimaryEmailAddr: { Address: 'joeguhl@gmail.com' }, Active: true };
  const db = makeDb();
  const prop = joe(db, '999');
  assert.equal(await loadSync().ensureQboCustomer(db, prop), '223');
});

test('a healthy cached customer is kept — no re-matching, no new customer', async () => {
  customers['223'] = { Id: '223', DisplayName: 'Joe Uhl', PrimaryEmailAddr: { Address: 'joeguhl@gmail.com' }, Active: true };
  const db = makeDb();
  const prop = joe(db, '223');
  assert.equal(await loadSync().ensureQboCustomer(db, prop), '223');
  assert.ok(!calls.includes('query'), 'did not search for a replacement');
  assert.ok(!calls.includes('customer'), 'did not create a customer');
});

test('a bulk sync checks each customer once, not once per installment', async () => {
  customers['223'] = { Id: '223', DisplayName: 'Joe Uhl', PrimaryEmailAddr: { Address: 'joeguhl@gmail.com' }, Active: true };
  const db = makeDb();
  const prop = joe(db, '223');
  const sync = loadSync();
  for (let i = 0; i < 8; i++) await sync.ensureQboCustomer(db, prop);
  assert.equal(calls.filter(c => c === 'customer/223').length, 1);
});

test('a network or auth failure is NOT mistaken for a stale customer', async () => {
  qbo.qboFetch = async () => { throw new Error('QBO refresh failed (401): invalid_grant'); };
  const db = makeDb();
  const prop = joe(db, '223');
  await assert.rejects(loadSync().ensureQboCustomer(db, prop), /invalid_grant/);
  assert.equal(db.prepare('SELECT qbo_customer_id FROM properties WHERE id = ?').get(prop).qbo_customer_id, '223',
    'the good link survives a transient failure');
});

test('re-matching never picks an inactive customer, even by name', async () => {
  customers['150'] = { Id: '150', DisplayName: 'Joe Uhl', Active: false }; // no email; same name, inactive
  const db = makeDb();
  const prop = addProperty(db, 'Joe Uhl'); // no cached id, no email
  const id = await loadSync().ensureQboCustomer(db, prop);
  assert.notEqual(id, '150');
});
