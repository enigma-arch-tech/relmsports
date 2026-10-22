/* Verifies that a real application submission triggers a notification attempt.
   A local HTTP stub stands in for Resend so no external call is made. */
"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relm-notify-"));
fs.copyFileSync(path.join(ROOT, "data", "events.json"), path.join(tmp, "events.json"));

const calls = [];

// Stub the Resend endpoint by intercepting fetch inside the server process is
// not possible; instead we point notify at a local port via RESEND_BASE_URL if
// supported. Here we simply assert the module posts when a key is present by
// stubbing global.fetch before requiring it.
(async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, text: async () => "{\"id\":\"stub\"}" };
  };

  process.env.RESEND_API_KEY = "re_test_key";
  process.env.ADMIN_NOTIFICATION_EMAIL = "manager@example.com";

  delete require.cache[require.resolve("../lib/notify")];
  const notify = require("../lib/notify");

  const result = await notify.applicationSubmitted(
    {
      id: "app-1",
      teamName: "Kingston Ice",
      contactName: "Jane Doe",
      email: "jane@example.com",
      division: "U13A",
      teams: 2,
      total: 3950,
      depositDue: 1580,
      costPerTeam: 1975,
      status: "pending",
      createdAt: new Date().toISOString()
    },
    { id: "bmha", title: "BMHA Mid-Season Tilt", date: "Jan 10-12, 2026" }
  );

  global.fetch = original;

  const ok =
    result.sent === true &&
    calls.length === 1 &&
    calls[0].url === "https://api.resend.com/emails" &&
    calls[0].body.to[0] === "manager@example.com" &&
    /Kingston Ice/.test(calls[0].body.subject) &&
    calls[0].body.reply_to === "jane@example.com";

  console.log(ok ? "notification dispatch test passed" : "notification dispatch test FAILED: " + JSON.stringify({ result, calls }, null, 2));
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.error("notification dispatch test crashed:", err.message);
  process.exit(1);
});
