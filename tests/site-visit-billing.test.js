// A site visit must NEVER bill.
//
// Completing a visit is what activates monthly installments and cuts
// per-service invoices. A site visit is deliberately allowed to carry an
// estimate_id — that's the point, the visit produced the proposal — so
// without an explicit guard, marking one complete would charge a lead who
// hasn't agreed to anything. These tests are the guard rail.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate, addItem, addSchedule, addScheduledInvoices, invoicesFor } = require('./helpers');
const { billForCompletedVisit } = require('../utils/billing');

const scheduleRow = (db, id) => db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);

test('completing a site visit on a MONTHLY estimate activates nothing', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Lead Larry');
  const est = addEstimate(db, { propertyId: prop, plan: 'monthly', months: 6, total: 600 });
  addScheduledInvoices(db, est);
  const visit = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Site Visit', kind: 'site_visit' });

  const result = billForCompletedVisit(db, scheduleRow(db, visit));
  assert.equal(result.action, 'none');
  assert.match(result.reason, /not_billable_kind/);

  const stillScheduled = invoicesFor(db, est).every(i => i.status === 'scheduled');
  assert.ok(stillScheduled, 'no installment may be activated by a measuring trip');
});

test('completing a site visit on a PER-SERVICE estimate creates no invoice', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Lead Linda');
  const est = addEstimate(db, { propertyId: prop, plan: 'per_service', total: 0 });
  addItem(db, est, 'Site Visit', 95); // even if someone priced it as a line item
  const visit = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Site Visit', kind: 'site_visit' });

  const result = billForCompletedVisit(db, scheduleRow(db, visit));
  assert.equal(result.action, 'none');
  assert.equal(invoicesFor(db, est).length, 0, 'no invoice may be created');
});

test('the guard is on kind, not on the service_type name', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Renamed Rita');
  const est = addEstimate(db, { propertyId: prop, plan: 'monthly', months: 6, total: 600 });
  addScheduledInvoices(db, est);
  // Someone renames the service type; the visit is still a site visit.
  const visit = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Walkthrough & Measure', kind: 'site_visit' });

  assert.equal(billForCompletedVisit(db, scheduleRow(db, visit)).action, 'none');
  assert.ok(invoicesFor(db, est).every(i => i.status === 'scheduled'));
});

test('a real service visit still bills normally — the guard is not too broad', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Customer Carl');
  const est = addEstimate(db, { propertyId: prop, plan: 'monthly', months: 6, total: 600 });
  addScheduledInvoices(db, est);
  const visit = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Fert', kind: 'service' });

  assert.equal(billForCompletedVisit(db, scheduleRow(db, visit)).action, 'activated');
  const first = invoicesFor(db, est).find(i => i.installment_number === 1);
  assert.equal(first.status, 'pending', 'normal billing is untouched');
});

test('legacy rows with no kind still bill (defaults must not break existing work)', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Legacy Lou');
  const est = addEstimate(db, { propertyId: prop, plan: 'monthly', months: 6, total: 600 });
  addScheduledInvoices(db, est);
  const visit = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Fert' });
  db.prepare('UPDATE schedules SET kind = NULL WHERE id = ?').run(visit); // pre-migration shape

  assert.equal(billForCompletedVisit(db, scheduleRow(db, visit)).action, 'activated');
});

test('a site visit with no estimate is a no-op, not an error', () => {
  const db = makeDb();
  const prop = addProperty(db, 'No Estimate Ned');
  const visit = addSchedule(db, { propertyId: prop, serviceType: 'Site Visit', kind: 'site_visit' });
  assert.equal(billForCompletedVisit(db, scheduleRow(db, visit)).action, 'none');
});

test('a second completed site visit still bills nothing', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Twice Tina');
  const est = addEstimate(db, { propertyId: prop, plan: 'monthly', months: 6, total: 600 });
  addScheduledInvoices(db, est);
  const v1 = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Site Visit', kind: 'site_visit', date: '2026-04-01' });
  const v2 = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Site Visit', kind: 'site_visit', date: '2026-04-08' });

  billForCompletedVisit(db, scheduleRow(db, v1));
  billForCompletedVisit(db, scheduleRow(db, v2));
  assert.ok(invoicesFor(db, est).every(i => i.status === 'scheduled'));
});

test('a site visit does not consume the "first completed visit" that activates billing', () => {
  const db = makeDb();
  const prop = addProperty(db, 'Converted Chris');
  const est = addEstimate(db, { propertyId: prop, plan: 'monthly', months: 6, total: 600 });
  addScheduledInvoices(db, est);

  // They were quoted after a site visit, signed, and then got real service.
  const site = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Site Visit', kind: 'site_visit', date: '2026-04-01' });
  billForCompletedVisit(db, scheduleRow(db, site));

  const real = addSchedule(db, { propertyId: prop, estimateId: est, serviceType: 'Fert', kind: 'service', date: '2026-05-01' });
  const result = billForCompletedVisit(db, scheduleRow(db, real));

  // activateBillingForEstimate counts completed visits for the estimate, and
  // the site visit is one of them — so billing must still fire on the first
  // REAL service visit, not be skipped as "already activated".
  assert.equal(result.action, 'activated', 'the first real service visit must still start billing');
  const first = invoicesFor(db, est).find(i => i.installment_number === 1);
  assert.equal(first.status, 'pending');
});
