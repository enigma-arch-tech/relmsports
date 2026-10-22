/* ==========================================================================
   RELM Sports — outbound notifications (lib/notify.js)

   Sends a structured confirmation email to the tournament manager whenever a
   new application is submitted. Transport is Resend's HTTPS API (no npm
   dependency, works on Node 18+ via the global fetch).

   Configuration (environment variables):
     RESEND_API_KEY            required to actually send. When it is missing the
                               module logs a warning and silently skips — a
                               submission must never fail because email is down.
     ADMIN_NOTIFICATION_EMAIL  recipient of the notification.
     RESEND_FROM               optional From header. Defaults to Resend's shared
                               onboarding sender, which may only deliver to the
                               Resend account owner's address until a domain is
                               verified.

   Exported function never throws and never rejects.
   ========================================================================== */

"use strict";

const DEFAULT_RECIPIENT = "relmtournaments@outlook.com";
const DEFAULT_FROM = "RELM Sports <onboarding@resend.dev>";
const SEND_TIMEOUT_MS = 8000;

function recipient() {
  return String(process.env.ADMIN_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT).trim();
}

function fromAddress() {
  return String(process.env.RESEND_FROM || DEFAULT_FROM).trim();
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(amount) {
  const value = Number(amount) || 0;
  return "CA$" + value.toLocaleString("en-CA");
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("en-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short"
    });
  } catch (err) {
    return String(value);
  }
}

function teamLabel(application, event) {
  const team = application.teamName || "—";
  const division = application.division ? " — " + application.division : "";
  const titles = [];
  if (event && event.title) titles.push(event.title);
  if (event && event.date) titles.push(event.date);
  return { team: team + division, event: titles.join(" · ") || "Unknown tournament" };
}

/* ------------------------------------------------------------ email body -- */

function buildRows(application, event) {
  const teams = Number(application.teams) || 1;
  const total = Number(application.total) || 0;
  const deposit = Number(application.depositDue) || 0;

  const payment = deposit
    ? "40% deposit — " + money(deposit) + " due at registration (balance within 7 days of acceptance)"
    : "Full payment — " + money(total) + " due at registration";

  const labels = teamLabel(application, event);

  return [
    ["Applicant / Coach", application.contactName || "—"],
    ["Email", application.email || "—"],
    ["Phone", "Not provided on the application form"],
    ["Team name & division", labels.team],
    ["Selected tournament", labels.event],
    ["Teams entered", String(teams)],
    ["Total cost", money(total) + " (CAD) — " + money(Number(application.costPerTeam) || 0) + " per team"],
    ["Payment option", payment],
    ["Roster link", "Not provided on the application form"],
    ["Waiver acknowledgement", "Not collected on the application form"],
    ["Notes", application.notes || "—"],
    ["Submitted", formatDate(application.createdAt)],
    ["Application ID", application.id || "—"],
    ["Current status", application.status || "pending"]
  ];
}

function buildSubject(application, event) {
  const labels = teamLabel(application, event);
  return "New tournament application — " + labels.team;
}

function buildText(application, event) {
  const rows = buildRows(application, event);
  const lines = ["A new tournament application was submitted on relmsports.com.", ""];
  rows.forEach(function (row) {
    lines.push(row[0] + ": " + row[1]);
  });
  lines.push("");
  lines.push("Review it in the admin dashboard: https://relmsports-five.vercel.app/admin.html");
  return lines.join("\n");
}

function buildHtml(application, event) {
  const rows = buildRows(application, event);
  const body = rows
    .map(function (row) {
      return (
        '<tr>' +
        '<td style="padding:8px 14px;border-bottom:1px solid #e6e9ee;font:600 13px/1.4 Barlow,Arial,sans-serif;color:#5b6577;white-space:nowrap;vertical-align:top">' +
        escapeHtml(row[0]) +
        "</td>" +
        '<td style="padding:8px 14px;border-bottom:1px solid #e6e9ee;font:400 14px/1.5 Barlow,Arial,sans-serif;color:#111827">' +
        escapeHtml(row[1]) +
        "</td>" +
        "</tr>"
      );
    })
    .join("");

  return (
    '<!DOCTYPE html><html><body style="margin:0;background:#f3f5f8;padding:24px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden">' +
    "<tr><td style=\"background:#0b1b33;padding:20px 24px\">" +
    '<h1 style="margin:0;font:800 18px/1.3 Orbitron,Barlow,Arial,sans-serif;color:#ffffff;letter-spacing:.5px">NEW TOURNAMENT APPLICATION</h1>' +
    '<p style="margin:6px 0 0;font:400 13px/1.4 Barlow,Arial,sans-serif;color:#a9b6cc">relmsports.com</p>' +
    "</td></tr>" +
    '<tr><td style="padding:20px 10px 8px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    body +
    "</table>" +
    "</td></tr>" +
    '<tr><td style="padding:16px 24px 24px">' +
    '<p style="margin:0;font:400 13px/1.5 Barlow,Arial,sans-serif;color:#5b6577">Sign in to the admin dashboard to review and action this application.</p>' +
    "</td></tr>" +
    "</table></body></html>"
  );
}

/* ---------------------------------------------------------------- sender -- */

async function postResend(payload) {
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, SEND_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error("Resend responded " + response.status + ": " + text.slice(0, 300));
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Notify the tournament manager about a new application.
 * Fire-and-forget safe: resolves regardless of outcome, never rejects.
 * @returns {Promise<{sent: boolean, skipped?: string, error?: string}>}
 */
async function applicationSubmitted(application, event) {
  const app = application || {};
  const ev = event || {};

  if (!process.env.RESEND_API_KEY) {
    console.warn("[notify] RESEND_API_KEY is not set — skipping new-application email.");
    return { sent: false, skipped: "no-api-key" };
  }

  const payload = {
    from: fromAddress(),
    to: [recipient()],
    subject: buildSubject(app, ev),
    text: buildText(app, ev),
    html: buildHtml(app, ev)
  };

  if (app.email) payload.reply_to = app.email;

  try {
    await postResend(payload);
    console.log("[notify] new-application email sent to " + recipient());
    return { sent: true };
  } catch (err) {
    // Never surface email failures to the applicant.
    console.error("[notify] could not send new-application email:", err && err.message ? err.message : err);
    return { sent: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  applicationSubmitted: applicationSubmitted,
  recipient: recipient,
  buildSubject: buildSubject,
  buildText: buildText,
  buildHtml: buildHtml
};
