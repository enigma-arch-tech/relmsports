/* Unit checks for lib/notify.js — the new-application email builder.

   No network access: the Resend transport is only exercised when
   RESEND_API_KEY is present, which it deliberately is not here. Run with:
     node tests/notify.js
   or through the full suite:  node tests/run.js  */
"use strict";

const assert = require("assert");
const notify = require("../lib/notify");

const application = {
  id: "app-123",
  status: "pending",
  teamName: "Kingston Ice",
  contactName: "Jane Doe",
  email: "jane@example.com",
  division: "U13A",
  teams: 2,
  notes: "Second team may follow.",
  costPerTeam: 1975,
  total: 3950,
  depositDue: 1580,
  createdAt: "2026-01-05T12:00:00.000Z"
};

const event = { id: "bmha", title: "BMHA Mid-Season Tilt", date: "Jan 10\u201312, 2026" };

const subject = notify.buildSubject(application, event);
assert.ok(/Kingston Ice/.test(subject), "subject names the team");
assert.ok(/U13A/.test(subject), "subject names the division");

const text = notify.buildText(application, event);
[
  "Applicant / Coach: Jane Doe",
  "Email: jane@example.com",
  "Team name & division: Kingston Ice \u2014 U13A",
  "Selected tournament: BMHA Mid-Season Tilt",
  "CA$1,580",
  "40% deposit"
].forEach(function (fragment) {
  assert.ok(text.indexOf(fragment) > -1, "text body includes: " + fragment);
});

const html = notify.buildHtml(application, event);
assert.ok(html.indexOf("<!DOCTYPE html>") === 0, "html body is a document");
assert.ok(html.indexOf("Jane Doe") > -1, "html body includes the coach name");
assert.ok(html.indexOf("Kingston Ice") > -1, "html body includes the team");

// Without an API key the sender must resolve quietly rather than throw.
notify.applicationSubmitted(application, event).then(function (result) {
  assert.strictEqual(result.sent, false, "no email is sent without RESEND_API_KEY");
  assert.strictEqual(result.skipped, "no-api-key", "the skip reason is reported");
  console.log("notify tests passed");
}).catch(function (err) {
  console.error("notify tests failed:", err.message);
  process.exit(1);
});
