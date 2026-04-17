// Composes SMS text from templates + visit context.
//
// Design: global envelope settings live in app_settings; per-service text lives
// on the services table. The composer pulls the right bits and stitches them
// together. The user edits the final output before sending, so the composer's
// job is to produce a sensible starting point, not a finished script.

// Read a setting with a fallback
function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row && row.value ? row.value : fallback;
}

// Friendly date for SMS: "Tue Apr 18" or "today" / "tomorrow"
function friendlyDate(isoDate, referenceDate) {
  const ref = referenceDate || new Date();
  const d = new Date(isoDate + 'T12:00:00'); // noon avoids DST edge cases
  const refStart = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((target - refStart) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Substitute {{variable}} placeholders in a template string.
function substitute(template, vars) {
  if (!template) return '';
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) => {
    return vars[key] != null ? String(vars[key]) : '';
  });
}

// Look up a service row by name (case-insensitive). Returns null if not found.
function lookupService(db, name) {
  if (!name) return null;
  const row = db.prepare('SELECT * FROM services WHERE LOWER(name) = LOWER(?) LIMIT 1').get(name.trim());
  return row || null;
}

// Parse a visit's service_type into individual service names.
// schedules.service_type can be a single name like "Weed Control" or a comma-
// separated bundle like "Aeration, Seeding, Compost".
function parseServiceNames(serviceType) {
  if (!serviceType) return [];
  return String(serviceType).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

// Compose the HEADS-UP text for tomorrow's visit.
// schedule: a row from schedules (with property_id, scheduled_date, service_type)
// property: a row from properties (customer_name, address, phone, etc.)
function composeHeadsUp(db, schedule, property) {
  const businessName = getSetting(db, 'msg_business_name', 'Clean Air Treatments');
  const greeting = getSetting(db, 'msg_greeting', 'Hi {{first_name}},');
  const headsUpIntro = getSetting(db, 'msg_heads_up_intro', '{{business_name}} will be at {{address}} {{friendly_date}} for:');
  const closing = getSetting(db, 'msg_heads_up_closing', 'Please unlock gates and secure pets. Reply with any questions.');
  const optOut = getSetting(db, 'msg_opt_out', 'Reply STOP to unsubscribe.');

  const firstName = (property.customer_name || '').split(/\s+/)[0] || 'there';
  const vars = {
    first_name: firstName,
    customer_name: property.customer_name || '',
    address: property.address || '',
    city: property.city || '',
    friendly_date: friendlyDate(schedule.scheduled_date),
    business_name: businessName,
    date: schedule.scheduled_date
  };

  // Build per-service lines
  const serviceNames = parseServiceNames(schedule.service_type);
  const lines = [];
  const actions = new Set();
  for (const name of serviceNames) {
    const svc = lookupService(db, name);
    if (svc && svc.heads_up_text) {
      lines.push('• ' + svc.heads_up_text.trim());
    } else {
      // Fallback: just list the service name if no template set yet
      lines.push('• ' + name);
    }
    if (svc && svc.client_action && svc.client_action.trim()) {
      actions.add(svc.client_action.trim());
    }
  }

  const parts = [
    substitute(greeting, vars),
    '',
    substitute(headsUpIntro, vars),
    ...lines
  ];
  if (actions.size > 0) {
    parts.push('');
    parts.push('After we\'re done: ' + Array.from(actions).join('; ') + '.');
  }
  parts.push('');
  parts.push(substitute(closing, vars));
  parts.push('');
  parts.push(substitute(optOut, vars));

  return parts.join('\n');
}

// Compose the COMPLETION text after a visit is done.
// application: a row from applications (with service info, property_id, etc.)
// property: a row from properties
// overrideServiceType: optional — if set, use instead of application's product_name
function composeCompletion(db, application, property, overrideServiceType) {
  const businessName = getSetting(db, 'msg_business_name', 'Clean Air Treatments');
  const greeting = getSetting(db, 'msg_greeting', 'Hi {{first_name}},');
  const completionIntro = getSetting(db, 'msg_completion_intro', 'We just finished at {{address}} today:');
  const reviewLine = getSetting(db, 'msg_review_line', 'Enjoyed our service? A quick review helps a ton: {{review_link}}');
  const reviewLink = getSetting(db, 'msg_review_link', '');
  const signature = getSetting(db, 'msg_signature', 'Thanks! — {{business_name}}');
  const optOut = getSetting(db, 'msg_opt_out', 'Reply STOP to unsubscribe.');

  const firstName = (property.customer_name || '').split(/\s+/)[0] || 'there';
  const vars = {
    first_name: firstName,
    customer_name: property.customer_name || '',
    address: property.address || '',
    business_name: businessName,
    review_link: reviewLink,
    date: application.application_date
  };

  // Determine what services were performed
  const serviceNames = parseServiceNames(overrideServiceType || application.product_name || '');
  const lines = [];
  const actions = new Set();
  for (const name of serviceNames) {
    const svc = lookupService(db, name);
    if (svc && svc.completion_text) {
      lines.push('• ' + svc.completion_text.trim());
    } else {
      lines.push('• ' + name);
    }
    if (svc && svc.client_action && svc.client_action.trim()) {
      actions.add(svc.client_action.trim());
    }
  }

  const parts = [
    substitute(greeting, vars),
    '',
    substitute(completionIntro, vars),
    ...lines
  ];
  if (actions.size > 0) {
    parts.push('');
    parts.push('Reminder: ' + Array.from(actions).join('; ') + '.');
  }
  if (reviewLink) {
    parts.push('');
    parts.push(substitute(reviewLine, vars));
  }
  parts.push('');
  parts.push(substitute(signature, vars));
  parts.push(substitute(optOut, vars));

  return parts.join('\n');
}

module.exports = {
  composeHeadsUp,
  composeCompletion,
  parseServiceNames,
  friendlyDate,
  substitute
};
