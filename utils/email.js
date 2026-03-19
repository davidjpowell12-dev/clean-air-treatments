const sgMail = require('@sendgrid/mail');

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'estimates@cleanairlawncare.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Clean Air Lawn Care';

let initialized = false;

function init() {
  if (initialized) return true;
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.warn('[email] SENDGRID_API_KEY not set — email sending disabled');
    return false;
  }
  sgMail.setApiKey(apiKey);
  initialized = true;
  return true;
}

function isEnabled() {
  return !!process.env.SENDGRID_API_KEY;
}

async function sendProposalEmail({ to, customerName, monthlyPrice, totalPrice, paymentMonths, proposalUrl, validUntil }) {
  if (!init()) {
    throw new Error('Email not configured. Set SENDGRID_API_KEY environment variable.');
  }

  const validStr = validUntil
    ? new Date(validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4a7c2e 0%,#3a6324 100%);border-radius:12px 12px 0 0;padding:32px 24px;text-align:center;">
      <h1 style="color:white;font-size:22px;margin:0 0 4px;">Clean Air Lawn Care</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:0;">Your Lawn Care Proposal</p>
    </div>

    <!-- Body -->
    <div style="background:white;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <p style="font-size:16px;color:#374151;margin:0 0 24px;">
        Hi ${escHtml(customerName)},
      </p>
      <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
        Thank you for your interest in Clean Air Lawn Care! We've prepared a customized lawn care proposal for you.
      </p>

      <!-- Price highlight -->
      <div style="background:linear-gradient(135deg,#1a2744 0%,#243656 100%);border-radius:12px;padding:24px;text-align:center;margin:0 0 24px;">
        <div style="font-size:48px;font-weight:800;color:white;line-height:1;">
          <span style="font-size:28px;vertical-align:top;">$</span>${Math.round(monthlyPrice)}
        </div>
        <div style="color:rgba(255,255,255,0.8);font-size:15px;margin-top:4px;">/month over ${paymentMonths} months</div>
        <div style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:2px;">Season Total: $${Math.round(totalPrice).toLocaleString()}</div>
      </div>

      <!-- CTA Button -->
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${proposalUrl}" style="display:inline-block;padding:16px 48px;background:linear-gradient(135deg,#4a7c2e 0%,#6b9e47 100%);color:white;text-decoration:none;border-radius:10px;font-size:17px;font-weight:700;letter-spacing:0.3px;">
          View Your Proposal
        </a>
      </div>

      <p style="font-size:14px;color:#9ca3af;text-align:center;margin:0 0 8px;">
        Click the button above to view your full proposal details and accept online.
      </p>

      ${validStr ? `
        <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
          This proposal is valid until ${validStr}
        </p>
      ` : ''}
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;font-size:12px;color:#9ca3af;">
      <p style="margin:0;">Clean Air Lawn Care</p>
      <p style="margin:4px 0 0;">The Neighborhood's Healthiest Lawn</p>
    </div>
  </div>
</body>
</html>`;

  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `Your Lawn Care Proposal — $${Math.round(monthlyPrice)}/month`,
    html
  };

  await sgMail.send(msg);
}

async function sendReminderEmail({ to, customerName, monthlyPrice, totalPrice, paymentMonths, proposalUrl, reminderNumber }) {
  if (!init()) {
    throw new Error('Email not configured. Set SENDGRID_API_KEY environment variable.');
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#4a7c2e 0%,#3a6324 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <h1 style="color:white;font-size:20px;margin:0;">Clean Air Lawn Care</h1>
    </div>
    <div style="background:white;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <p style="font-size:16px;color:#374151;margin:0 0 16px;">Hi ${escHtml(customerName)},</p>
      <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
        Just a friendly reminder — your lawn care proposal for <strong>$${Math.round(monthlyPrice)}/month</strong> is still waiting for you. We'd love to get you on the schedule!
      </p>

      <div style="text-align:center;margin:0 0 24px;">
        <a href="${proposalUrl}" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#4a7c2e 0%,#6b9e47 100%);color:white;text-decoration:none;border-radius:10px;font-size:16px;font-weight:700;">
          View Proposal
        </a>
      </div>

      <p style="font-size:13px;color:#9ca3af;text-align:center;margin:0;">
        If you have any questions, just reply to this email.
      </p>
    </div>
    <div style="text-align:center;padding:16px 0;font-size:12px;color:#9ca3af;">
      <p style="margin:0;">Clean Air Lawn Care</p>
    </div>
  </div>
</body>
</html>`;

  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `Reminder: Your Lawn Care Proposal — $${Math.round(monthlyPrice)}/month`,
    html
  };

  await sgMail.send(msg);
}

async function sendInvoiceEmail({ to, customerName, invoiceNumber, amount, dueDate, paymentUrl }) {
  if (!init()) throw new Error('Email not configured.');

  const dueDateStr = dueDate
    ? new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'upon receipt';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#4a7c2e 0%,#3a6324 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <h1 style="color:white;font-size:20px;margin:0;">Clean Air Lawn Care</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:4px 0 0;">Invoice ${escHtml(invoiceNumber)}</p>
    </div>
    <div style="background:white;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <p style="font-size:16px;color:#374151;margin:0 0 16px;">Hi ${escHtml(customerName)},</p>
      <p style="font-size:15px;color:#6b7280;line-height:1.6;margin:0 0 24px;">
        You have a new invoice from Clean Air Lawn Care.
      </p>

      <div style="background:#f9fafb;border-radius:10px;padding:24px;text-align:center;margin:0 0 24px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;margin:0 0 8px;">Amount Due</div>
        <div style="font-size:40px;font-weight:800;color:#1a2744;">$${escHtml(amount)}</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:8px;">Due: ${dueDateStr}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:4px;font-family:monospace;">${escHtml(invoiceNumber)}</div>
      </div>

      ${paymentUrl ? `
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${paymentUrl}" style="display:inline-block;padding:16px 48px;background:linear-gradient(135deg,#4a7c2e 0%,#6b9e47 100%);color:white;text-decoration:none;border-radius:10px;font-size:17px;font-weight:700;">
            Pay Now
          </a>
        </div>
      ` : ''}

      <p style="font-size:13px;color:#9ca3af;text-align:center;margin:0;">
        Questions? Just reply to this email.
      </p>
    </div>
    <div style="text-align:center;padding:16px 0;font-size:12px;color:#9ca3af;">
      <p style="margin:0;">Clean Air Lawn Care</p>
    </div>
  </div>
</body>
</html>`;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `Invoice ${invoiceNumber} — $${amount} due ${dueDateStr}`,
    html
  });
}

async function sendPaymentConfirmationEmail({ to, customerName, invoiceNumber, amount, paymentMethod }) {
  if (!init()) throw new Error('Email not configured.');

  const methodLabel = paymentMethod === 'ach' ? 'bank transfer' : paymentMethod === 'check' ? 'check' : 'card';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:linear-gradient(135deg,#4a7c2e 0%,#3a6324 100%);border-radius:12px 12px 0 0;padding:24px;text-align:center;">
      <h1 style="color:white;font-size:20px;margin:0;">Clean Air Lawn Care</h1>
      <p style="color:rgba(255,255,255,0.85);font-size:14px;margin:4px 0 0;">Payment Receipt</p>
    </div>
    <div style="background:white;padding:32px 24px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <div style="text-align:center;margin:0 0 24px;">
        <div style="width:64px;height:64px;border-radius:50%;background:#ecfdf5;display:inline-flex;align-items:center;justify-content:center;font-size:32px;">&#9989;</div>
      </div>
      <p style="font-size:16px;color:#374151;margin:0 0 16px;text-align:center;">
        Hi ${escHtml(customerName)}, your payment has been received!
      </p>

      <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:0 0 24px;">
        <table style="width:100%;font-size:14px;color:#374151;">
          <tr><td style="padding:6px 0;color:#9ca3af;">Invoice</td><td style="padding:6px 0;text-align:right;font-family:monospace;font-weight:600;">${escHtml(invoiceNumber)}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;">Amount</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:18px;">$${escHtml(amount)}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;">Payment Method</td><td style="padding:6px 0;text-align:right;text-transform:capitalize;">${methodLabel}</td></tr>
          <tr><td style="padding:6px 0;color:#9ca3af;">Date</td><td style="padding:6px 0;text-align:right;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td></tr>
        </table>
      </div>

      <p style="font-size:13px;color:#9ca3af;text-align:center;margin:0;">
        Thank you for choosing Clean Air Lawn Care!
      </p>
    </div>
    <div style="text-align:center;padding:16px 0;font-size:12px;color:#9ca3af;">
      <p style="margin:0;">Clean Air Lawn Care</p>
    </div>
  </div>
</body>
</html>`;

  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: `Payment Receipt — ${invoiceNumber} — $${amount}`,
    html
  });
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { sendProposalEmail, sendReminderEmail, sendInvoiceEmail, sendPaymentConfirmationEmail, isEnabled };
