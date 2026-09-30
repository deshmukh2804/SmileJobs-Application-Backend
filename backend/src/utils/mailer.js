const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const nodemailer = require("nodemailer");

const FROM_NAME = process.env.EMAIL_FROM_NAME || "Smile Jobs";
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_FROM_ADDRESS || "info.smilejobs@gmail.com";
const REPLY_TO = process.env.EMAIL_REPLY_TO || FROM_EMAIL;
const APP_NAME = process.env.APP_NAME || "Smile Jobs";
const APP_TAGLINE = process.env.APP_TAGLINE || "Find Your Dream Job. Get Hired 10X Faster.";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://smilejobs.in";

// Determine key type (SMTP vs API)
const rawKey = process.env.SMTP_PASS || process.env.EMAIL_PASS;
const isBrevoApiKey = typeof rawKey === "string" && rawKey.startsWith("xkeysib-");

/**
 * Filters out invalid address targets and mock handles
 */
const isValidDeliverableEmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (
    clean.endsWith("@phone.verihire.local") ||
    clean.includes("phone.local") ||
    clean.includes("test.local")
  ) {
    return false;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(clean);
};

/**
 * Send email via Brevo HTTPS REST API (Port 443 - Used only if xkeysib- API key is provided)
 */
const sendViaBrevoApi = async ({ to, subject, html, text, recipientName = "User" }) => {
  const payload = {
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: to.trim(), name: recipientName }],
    replyTo: { email: REPLY_TO, name: FROM_NAME },
    subject: subject.trim(),
    htmlContent: html,
    textContent: text || html.replace(/<[^>]*>/g, ""),
  };

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": rawKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Brevo API Error (${response.status})`);
  }
  return { success: true, messageId: data.messageId };
};

/**
 * Configure Nodemailer SMTP Transporter
 */
let transporter = null;
const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp-relay.brevo.com";
  let port = parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || "587", 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;

  // Auto-switch port 587 to 2525 on Render/Production to bypass outbound port blocking
  if (port === 587 && (process.env.RENDER || process.env.NODE_ENV === "production")) {
    console.log("ℹ️ Render hosting detected: Auto-switching SMTP Port from 587 to 2525 to bypass platform restrictions.");
    port = 2525;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass: rawKey,
    },
    tls: {
      rejectUnauthorized: false,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
};

/**
 * Send a single email
 */
const sendEmail = async ({ to, subject, html, text, recipientName }) => {
  try {
    if (!to || !subject || !html) {
      throw new Error("Missing required email parameters (to, subject, html)");
    }

    if (!isValidDeliverableEmail(to)) {
      console.log(`⏩ Skipped invalid/mock address: [${to}]`);
      return { success: false, error: "Skipped: Not a deliverable email address" };
    }

    if (isBrevoApiKey) {
      const result = await sendViaBrevoApi({ to, subject, html, text, recipientName });
      console.log(`📧 [Brevo HTTPS API] Sent successfully to ${to} | ID: ${result.messageId}`);
      return result;
    }

    // SMTP Fallback (using secure alternate port 2525)
    const transport = getTransporter();
    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: to.trim(),
      replyTo: REPLY_TO,
      subject: subject.trim(),
      html,
      text: text || html.replace(/<[^>]*>/g, ""),
    };

    const info = await transport.sendMail(mailOptions);
    console.log(`📧 [Brevo SMTP] Sent successfully to ${to} | ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(`❌ Dispatch failed to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send bulk emails in batches
 */
const sendBulkEmail = async (
  recipients,
  subject,
  htmlTemplate,
  batchSize = 10,
  delayMs = 1500
) => {
  const results = {
    total: recipients.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const validRecipients = [];
  for (const r of recipients) {
    const email = typeof r === "string" ? r : r?.email;
    if (isValidDeliverableEmail(email)) {
      validRecipients.push(r);
    } else {
      results.skipped++;
    }
  }

  const batches = [];
  for (let i = 0; i < validRecipients.length; i += batchSize) {
    batches.push(validRecipients.slice(i, i + batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    const promises = batch.map(async (recipient) => {
      const email = typeof recipient === "string" ? recipient : recipient.email;
      const name = typeof recipient === "object" ? recipient.name || "User" : "User";
      const phone = typeof recipient === "object" ? recipient.phone || "" : "";
      const city = typeof recipient === "object" ? recipient.city || "" : "";

      const personalizedHtml = htmlTemplate
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{email\}\}/g, email)
        .replace(/\{\{phone\}\}/g, phone)
        .replace(/\{\{city\}\}/g, city)
        .replace(
          /\{\{unsubscribeLink\}\}/g,
          `${FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(email)}`
        );

      const result = await sendEmail({
        to: email,
        subject,
        html: personalizedHtml,
        recipientName: name,
      });

      if (result.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push({ email, error: result.error });
      }
    });

    await Promise.all(promises);

    if (batchIndex < batches.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    console.log(
      `📧 Batch Progress: ${batchIndex + 1}/${batches.length} | Sent: ${results.sent} | Failed: ${results.failed} | Skipped: ${results.skipped}`
    );
  }

  return results;
};

/**
 * Verify Connection
 */
const verifyConnection = async () => {
  if (isBrevoApiKey) {
    try {
      const res = await fetch("https://api.brevo.com/v3/account", {
        headers: { "api-key": rawKey },
      });
      if (res.ok) {
        const acc = await res.json();
        return { success: true, method: "Brevo HTTPS API", account: acc.email };
      }
      const errData = await res.json();
      return { success: false, error: errData.message };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  try {
    const transport = getTransporter();
    await transport.verify();
    return { success: true, method: "Brevo SMTP Relay" };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Startup verification
(async () => {
  const res = await verifyConnection();
  if (res.success) {
    console.log(`✅ Email Connection Verified via [${res.method}] for: ${FROM_EMAIL}`);
  } else {
    console.warn(`⚠️ Mailer startup connection warning: ${res.error}`);
  }
})();

/**
 * ─────────────────────────────────────────────────────
 * 🎨 SMILE JOBS BRANDED EMAIL TEMPLATE
 * ─────────────────────────────────────────────────────
 * Features:
 * - Custom "SJ" logo mark with gradient background
 * - Smile Jobs branded header with tagline
 * - Purple gradient theme matching mobile app (#42326E)
 * - Feature highlights row (50K+ Recruiters, 10X Faster)
 * - Responsive footer with contact info
 */
const wrapEmailTemplate = (content, options = {}) => {
  const { heading = "", footerNote = "", buttonText, buttonUrl } = options;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${APP_NAME} - ${heading || 'Notification'}</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F1FA;font-family:'Segoe UI',Roboto,-apple-system,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F1FA;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border-radius:16px;box-shadow:0 4px 20px rgba(66,50,110,0.08);overflow:hidden;">

          <!-- ═══════ SMILE JOBS BRANDED HEADER ═══════ -->
          <tr>
            <td style="background:linear-gradient(135deg,#42326E 0%,#6E44D3 60%,#7C3AED 100%);padding:36px 28px;text-align:center;">
              <!-- Logo Mark SJ -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 14px;">
                <tr>
                  <td style="background:rgba(255,255,255,0.18);width:60px;height:60px;border-radius:16px;text-align:center;vertical-align:middle;border:2px solid rgba(255,255,255,0.3);">
                    <span style="color:#FFFFFF;font-size:26px;font-weight:900;letter-spacing:1px;line-height:60px;">SJ</span>
                  </td>
                </tr>
              </table>
              <!-- App Name -->
              <h1 style="margin:0;color:#FFFFFF;font-size:28px;font-weight:900;letter-spacing:-0.5px;">
                ${APP_NAME}
              </h1>
              <!-- Tagline -->
              <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:13px;font-weight:500;letter-spacing:0.3px;">
                ${APP_TAGLINE}
              </p>
              ${
                heading
                  ? `<div style="margin-top:16px;display:inline-block;padding:6px 16px;background:rgba(255,255,255,0.2);border-radius:20px;">
                       <span style="color:#FFFFFF;font-size:12px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${heading}</span>
                     </div>`
                  : ''
              }
            </td>
          </tr>

          <!-- ═══════ MAIN BODY CONTENT ═══════ -->
          <tr>
            <td style="padding:36px 32px 24px;color:#29233A;font-size:15px;line-height:1.65;">
              ${content}
              ${
                buttonText && buttonUrl
                  ? `<div style="text-align:center;margin:32px 0 12px;">
                       <a href="${buttonUrl}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#42326E 0%,#6E44D3 100%);color:#FFFFFF;text-decoration:none;font-weight:700;font-size:14px;border-radius:10px;box-shadow:0 4px 12px rgba(66,50,110,0.3);letter-spacing:0.3px;">
                         ${buttonText}
                       </a>
                     </div>`
                  : ''
              }
            </td>
          </tr>

          <!-- ═══════ FEATURE HIGHLIGHTS ROW ═══════ -->
          <tr>
            <td style="padding:16px 28px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F6FD;border-radius:12px;padding:16px 12px;border:1px solid #E8E3EF;">
                <tr>
                  <td align="center" width="33%" style="padding:8px 4px;">
                    <div style="font-size:22px;font-weight:900;color:#42326E;line-height:1;">50K+</div>
                    <div style="font-size:10px;color:#6F687A;margin-top:4px;font-weight:600;">Recruiters</div>
                  </td>
                  <td align="center" width="33%" style="padding:8px 4px;border-left:1px solid #E8E3EF;border-right:1px solid #E8E3EF;">
                    <div style="font-size:22px;font-weight:900;color:#6E44D3;line-height:1;">10X</div>
                    <div style="font-size:10px;color:#6F687A;margin-top:4px;font-weight:600;">Faster Hiring</div>
                  </td>
                  <td align="center" width="33%" style="padding:8px 4px;">
                    <div style="font-size:22px;font-weight:900;color:#42326E;line-height:1;">★</div>
                    <div style="font-size:10px;color:#6F687A;margin-top:4px;font-weight:600;">Verified HRs</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═══════ FOOTER ═══════ -->
          <tr>
            <td style="background-color:#FAF7FD;padding:24px 28px;text-align:center;border-top:1px solid #EFE9FC;">
              ${
                footerNote
                  ? `<p style="margin:0 0 12px;font-size:12px;color:#6F687A;line-height:1.5;">${footerNote}</p>`
                  : ''
              }
              <p style="margin:0 0 8px;font-size:11px;color:#94A3B8;line-height:1.6;">
                © ${new Date().getFullYear()} <b style="color:#42326E;">${APP_NAME}</b>. All rights reserved.<br>
                Need assistance? Contact us at 
                <a href="mailto:${REPLY_TO}" style="color:#6E44D3;text-decoration:none;font-weight:600;">${REPLY_TO}</a>
              </p>
              <p style="margin:12px 0 0;font-size:10px;color:#B2A6CE;">
                You received this email because you have an account with ${APP_NAME}.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

module.exports = {
  getTransporter,
  sendEmail,
  sendBulkEmail,
  verifyConnection,
  wrapEmailTemplate,
  isValidDeliverableEmail,
};