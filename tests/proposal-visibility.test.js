// Who can see a proposal, and what looking at it changes.
//
// Two rules pull in opposite directions:
//   - A customer must not reach a draft (it isn't finished or sent).
//   - The owner must be able to preview one — that's how you check your work
//     before sending, and "View as Customer" is the only view of the REAL
//     page rather than an in-app reimplementation of it.
// And previewing must leave no trace: viewed_at is what tells the owner the
// customer opened the proposal.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeDb, addProperty, addEstimate } = require('./helpers');

// Mirrors the visibility rules in routes/estimates.js GET /public/:token.
function loadProposal(db, token, { staff = false } = {}) {
  const est = db.prepare('SELECT * FROM estimates WHERE token = ?').get(token);
  if (!est) return { status: 404 };
  if (est.status === 'draft' && !staff) return { status: 404 };
  if (est.status === 'sent' && !staff) {
    db.prepare("UPDATE estimates SET status = 'viewed', viewed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(new Date().toISOString(), est.id);
  }
  return { status: 200, staff_preview: staff || undefined, estimate: db.prepare('SELECT * FROM estimates WHERE id = ?').get(est.id) };
}

function withToken(db, estId, token, status) {
  db.prepare('UPDATE estimates SET token = ?, status = ? WHERE id = ?').run(token, status, estId);
  return token;
}

test('the owner CAN preview a draft — this is the bug that was reported', () => {
  const db = makeDb();
  const est = addEstimate(db, { propertyId: addProperty(db, 'Dorothy'), name: 'Dorothy' });
  withToken(db, est, 'tok-draft', 'draft');

  assert.equal(loadProposal(db, 'tok-draft', { staff: true }).status, 200);
});

test('a customer CANNOT reach a draft', () => {
  const db = makeDb();
  const est = addEstimate(db, { propertyId: addProperty(db, 'Dorothy'), name: 'Dorothy' });
  withToken(db, est, 'tok-draft', 'draft');

  assert.equal(loadProposal(db, 'tok-draft').status, 404, 'unsent work stays private');
});

test('the owner previewing a SENT proposal does not mark it opened', () => {
  const db = makeDb();
  const est = addEstimate(db, { propertyId: addProperty(db, 'Sent Sam'), name: 'Sent Sam' });
  withToken(db, est, 'tok-sent', 'sent');

  loadProposal(db, 'tok-sent', { staff: true });
  const after = db.prepare('SELECT status, viewed_at FROM estimates WHERE id = ?').get(est);
  assert.equal(after.status, 'sent', 'still awaiting the customer');
  assert.equal(after.viewed_at, null, 'viewed_at must mean the CUSTOMER opened it');
});

test('a real customer opening a sent proposal still marks it viewed', () => {
  const db = makeDb();
  const est = addEstimate(db, { propertyId: addProperty(db, 'Sent Sue'), name: 'Sent Sue' });
  withToken(db, est, 'tok-sent2', 'sent');

  loadProposal(db, 'tok-sent2');
  const after = db.prepare('SELECT status, viewed_at FROM estimates WHERE id = ?').get(est);
  assert.equal(after.status, 'viewed');
  assert.ok(after.viewed_at, 'tracking still works');
});

test('the response flags a staff preview so the page can warn', () => {
  const db = makeDb();
  const est = addEstimate(db, { propertyId: addProperty(db, 'Flagged Fay'), name: 'Flagged Fay' });
  withToken(db, est, 'tok-flag', 'draft');

  assert.equal(loadProposal(db, 'tok-flag', { staff: true }).staff_preview, true);
  withToken(db, est, 'tok-flag', 'sent');
  assert.equal(loadProposal(db, 'tok-flag').staff_preview, undefined, 'customers never see the flag');
});

test('an unknown token is 404 for everyone, staff included', () => {
  const db = makeDb();
  assert.equal(loadProposal(db, 'nope').status, 404);
  assert.equal(loadProposal(db, 'nope', { staff: true }).status, 404);
});

test('accepted and declined proposals are unaffected by previewing', () => {
  const db = makeDb();
  for (const status of ['accepted', 'declined']) {
    const est = addEstimate(db, { propertyId: addProperty(db, 'X ' + status), name: 'X' });
    withToken(db, est, 'tok-' + status, status);
    assert.equal(loadProposal(db, 'tok-' + status, { staff: true }).status, 200);
    assert.equal(db.prepare('SELECT status FROM estimates WHERE id = ?').get(est).status, status, 'status untouched');
  }
});
