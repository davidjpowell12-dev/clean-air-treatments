// Pre-visit heads-up notifications.
//
// Two channels, one source of truth:
//  - generateHeadsUpDrafts(db, date): SMS drafts for every opted-in customer
//    with a visit on `date`. Idempotent per schedule. Used by the Messaging
//    page's "Generate" button AND the evening cron.
//  - runEveningHeadsUps(db, {date, sendEmail}): the evening-before job. Auto-
//    emails every customer with a visit on `date` (idempotent via
//    schedules.heads_up_emailed_at), then generates the SMS drafts so they're
//    waiting for review. Emails are sent automatically; SMS stays draft-first.
//
// Per-property heads_up_note ("Please have pets and kids inside") is folded
// into both channels by the composer.
const { composeHeadsUp } = require('./message-composer');

function tomorrowLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Visits on `date` that are still happening, with the property fields both
// channels need. Explicit column list — never pulls internal notes into
// anything customer-facing beyond what the composer uses.
function getVisitsForDate(db, date) {
  return db.prepare(`
    SELECT s.id, s.property_id, s.scheduled_date, s.service_type, s.status,
           s.heads_up_emailed_at,
           p.customer_name, p.address, p.city, p.phone, p.email,
           p.sms_opted_in, p.heads_up_note
    FROM schedules s
    JOIN properties p ON p.id = s.property_id
    WHERE s.scheduled_date = ?
      AND s.status != 'completed'
      AND s.status != 'cancelled'
    ORDER BY p.customer_name
  `).all(date);
}

// SMS drafts (moved verbatim from routes/messaging.js so the route and the
// cron can't drift). Returns the same counts the route responds with.
function generateHeadsUpDrafts(db, date) {
  date = date || tomorrowLocal();
  const visits = getVisitsForDate(db, date);

  let created = 0, skipped_existing = 0, skipped_opted_out = 0, skipped_no_phone = 0;
  const createdDrafts = [];

  for (const v of visits) {
    const existing = db.prepare(`
      SELECT id FROM message_drafts
      WHERE schedule_id = ? AND type = 'heads_up' AND status IN ('draft','sent')
    `).get(v.id);
    if (existing) { skipped_existing++; continue; }

    if (v.sms_opted_in === 0) { skipped_opted_out++; continue; }
    if (!v.phone || !v.phone.trim()) { skipped_no_phone++; continue; }

    const composedText = composeHeadsUp(db, v, v);
    const result = db.prepare(`
      INSERT INTO message_drafts (
        property_id, schedule_id, type, service_date, service_summary,
        composed_text, to_phone, status
      ) VALUES (?, ?, 'heads_up', ?, ?, ?, ?, 'draft')
    `).run(
      v.property_id, v.id, v.scheduled_date, v.service_type || '',
      composedText, v.phone
    );
    createdDrafts.push(result.lastInsertRowid);
    created++;
  }

  return { date, created, skipped_existing, skipped_opted_out, skipped_no_phone, draft_ids: createdDrafts };
}

// The evening-before job. `sendEmail` is injectable: pass
// email.sendHeadsUpEmail in production, a stub in tests, or null to skip the
// email channel entirely (e.g. SendGrid not configured) while still
// generating SMS drafts. Never throws — cron-safe.
async function runEveningHeadsUps(db, { date, sendEmail } = {}) {
  date = date || tomorrowLocal();
  const visits = getVisitsForDate(db, date);

  let emailed = 0, email_already_sent = 0, email_no_address = 0, email_failed = 0;

  if (sendEmail) {
    for (const v of visits) {
      if (v.heads_up_emailed_at) { email_already_sent++; continue; }
      const to = (v.email || '').trim();
      if (!to) { email_no_address++; continue; }

      try {
        await sendEmail({
          to,
          customerName: v.customer_name,
          serviceDate: v.scheduled_date,
          serviceSummary: v.service_type || 'Service',
          bodyText: composeHeadsUp(db, v, v, { omitOptOut: true }),
        });
        db.prepare('UPDATE schedules SET heads_up_emailed_at = CURRENT_TIMESTAMP WHERE id = ?').run(v.id);
        emailed++;
      } catch (err) {
        email_failed++;
        console.error(`[heads-up] Email failed for schedule ${v.id} (${v.customer_name}):`, err.message);
      }
    }
  }

  const drafts = generateHeadsUpDrafts(db, date);

  return {
    date,
    visits: visits.length,
    emailed,
    email_already_sent,
    email_no_address,
    email_failed,
    email_channel: sendEmail ? 'on' : 'off',
    sms_drafts_created: drafts.created,
    sms_drafts_existing: drafts.skipped_existing,
  };
}

module.exports = { generateHeadsUpDrafts, runEveningHeadsUps, getVisitsForDate, tomorrowLocal };
