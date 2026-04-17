// Twilio SMS wrapper with graceful dry-run fallback.
//
// If TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are all set
// AND the `twilio` package is installed, messages are sent for real.
//
// Otherwise, every "send" is a no-op that logs what WOULD have been sent and
// returns { dry_run: true, ... }. This lets us ship the feature and test the
// UI before the user completes A2P 10DLC registration.

let twilioClient = null;
let clientAttempted = false;
let clientError = null;

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
}

function getClient() {
  if (clientAttempted) return twilioClient;
  clientAttempted = true;
  if (!isConfigured()) {
    clientError = 'Twilio env vars not set';
    return null;
  }
  try {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('[twilio] Client initialized');
    return twilioClient;
  } catch (err) {
    clientError = 'twilio package not installed: ' + err.message;
    console.warn('[twilio] ' + clientError + ' — running in dry-run mode');
    return null;
  }
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  // US numbers only for now — 10-digit gets +1 prefix, 11-digit starting with 1 gets +
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  if (digits.length >= 11) return '+' + digits;
  return null; // invalid
}

// Send an SMS. Returns { success, sid?, dry_run?, error?, to }.
async function sendSms(toPhone, body) {
  const normalized = normalizePhone(toPhone);
  if (!normalized) {
    return { success: false, error: 'Invalid phone number', to: toPhone };
  }

  const client = getClient();
  if (!client) {
    // Dry-run: log and return without sending
    console.log(`[twilio:DRY-RUN] To ${normalized}: ${body.slice(0, 60)}${body.length > 60 ? '…' : ''}`);
    return {
      success: true,
      dry_run: true,
      to: normalized,
      reason: clientError || 'not configured',
      body_length: body.length
    };
  }

  try {
    const msg = await client.messages.create({
      to: normalized,
      from: process.env.TWILIO_PHONE_NUMBER,
      body
    });
    return {
      success: true,
      dry_run: false,
      sid: msg.sid,
      to: normalized,
      status: msg.status
    };
  } catch (err) {
    console.error('[twilio] Send failed:', err.message);
    return {
      success: false,
      error: err.message,
      code: err.code,
      to: normalized
    };
  }
}

module.exports = { sendSms, isConfigured, normalizePhone };
