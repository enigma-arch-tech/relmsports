/* End-to-end smoke test for the RELM replica API.
   Normally run through `node tests/run.js`, which starts an isolated server on
   its own port + data directory. You can also target a running server:
     BASE=http://localhost:3000 ADMIN_EMAIL=you@example.com node tests/e2e.js */
const BASE = process.env.BASE || "http://localhost:3000";
let pass = 0;
let fail = 0;

function check(name, ok, extra) {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? "  -> " + extra : ""));
  }
}

async function req(path, opts) {
  const res = await fetch(BASE + path, {
    method: (opts && opts.method) || "GET",
    headers: Object.assign({ "Content-Type": "application/json" }, (opts && opts.token) ? { Authorization: "Bearer " + opts.token } : {}),
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data };
}

(async () => {
  const stamp = Date.now();
  const memberEmail = "test.member." + stamp + "@example.com";
  const adminEmail = process.env.ADMIN_EMAIL || "relmtournaments@outlook.com";
  const memberPass = "hockey12345";
  const adminPass = "hockey12345";

  console.log("\nStatic files");
  for (const p of ["/", "/index.html", "/account.html", "/apply.html", "/admin.html", "/tournaments.html", "/contact.html", "/css/styles.css", "/js/api.js", "/js/account.js", "/js/apply.js", "/js/admin.js", "/js/main.js", "/data/users.json"]) {
    const r = await req(p);
    const expectBlocked = p === "/data/users.json";
    check("GET " + p + " -> " + (expectBlocked ? 403 : 200), expectBlocked ? r.status === 403 : r.status === 200, "got " + r.status);
  }

  console.log("\nAdmin sign-in route");
  for (const p of ["/admin/login", "/admin/login.html", "/js/admin-login.js", "/account/applications"]) {
    const r = await req(p);
    check("GET " + p + " -> 200", r.status === 200, "got " + r.status);
  }

  console.log("\nSignup validation");
  let r = await req("/api/auth/signup", { method: "POST", body: { name: "x", email: "nope", password: "123" } });
  check("rejects bad signup with field errors", r.status === 400 && r.data.errors && r.data.errors.email && r.data.errors.password, JSON.stringify(r.data));

  console.log("\nSignup + session");
  r = await req("/api/auth/signup", { method: "POST", body: { name: "Test Member", email: memberEmail, password: memberPass } });
  check("creates member account", r.status === 201 && r.data.token && r.data.user.role === "member", JSON.stringify(r.data));
  const memberToken = r.data.token;

  r = await req("/api/auth/signup", { method: "POST", body: { name: "Test Member", email: memberEmail, password: memberPass } });
  check("rejects duplicate email", r.status === 409, "got " + r.status);

  r = await req("/api/auth/me", { token: memberToken });
  check("me returns the account", r.status === 200 && r.data.user.email === memberEmail, JSON.stringify(r.data));

  r = await req("/api/auth/login", { method: "POST", body: { email: memberEmail, password: "wrong-password" } });
  check("rejects wrong password", r.status === 401, "got " + r.status);

  r = await req("/api/auth/login", { method: "POST", body: { email: memberEmail, password: memberPass } });
  check("logs in with correct password", r.status === 200 && r.data.token, JSON.stringify(r.data));

  console.log("\nEvents");
  r = await req("/api/events");
  check("lists 7 tournaments", r.status === 200 && r.data.events.length === 7, "got " + (r.data.events ? r.data.events.length : "?"));

  console.log("\nApplications");
  r = await req("/api/applications", { method: "POST", token: memberToken, body: { eventId: "bmha", teamName: "T", contactName: "x", email: "bad", division: "", teams: 1 } });
  check("rejects incomplete application", r.status === 400 && r.data.errors && Object.keys(r.data.errors).length >= 4, JSON.stringify(r.data));

  r = await req("/api/applications", { method: "POST", token: memberToken, body: { eventId: "nope", teamName: "Kingston Ice", contactName: "Jane Doe", email: memberEmail, division: "U13A", teams: 2 } });
  check("rejects unknown event", r.status === 400, "got " + r.status);

  r = await req("/api/applications", { method: "POST", token: memberToken, body: { eventId: "bmha", teamName: "Kingston Ice", contactName: "Jane Doe", email: memberEmail, division: "U13A", teams: 2, notes: "Second team may follow." } });
  check("submits an application", r.status === 201 && r.data.application.status === "pending" && r.data.application.event.title, JSON.stringify(r.data));
  const appId = r.data.application.id;

  check(
    "records the tournament fee (2 x $1,975)",
    r.data.application.costPerTeam === 1975 && r.data.application.total === 3950,
    JSON.stringify({ costPerTeam: r.data.application.costPerTeam, total: r.data.application.total })
  );
  check("BMHA deposit is 40% (2 x $790)", r.data.application.depositDue === 1580, "got " + r.data.application.depositDue);

  r = await req("/api/applications", { method: "POST", token: memberToken, body: { eventId: "bmha", teamName: "Kingston Ice", contactName: "Jane Doe", email: memberEmail, division: "U13A", teams: 2 } });
  check("blocks duplicate division entry", r.status === 409, "got " + r.status);

  r = await req("/api/applications", { method: "POST", body: { eventId: "bmha", teamName: "Anon", contactName: "Anon", email: "anon@example.com", division: "U13A", teams: 1 } });
  check("requires sign in to apply", r.status === 401, "got " + r.status);

  r = await req("/api/applications", { token: memberToken });
  check("member sees their application", r.status === 200 && r.data.applications.length === 1 && r.data.applications[0].event.id === "bmha", JSON.stringify(r.data).slice(0, 300));

  r = await req("/api/events");
  const bmha = r.data.events.find((e) => e.id === "bmha");
  check("event shows registered team count", bmha.registeredTeams === 1, "got " + bmha.registeredTeams);

  check(
    "every event publishes a cost",
    r.data.events.every((e) => typeof e.cost === "number" && e.cost > 0 && e.costLabel && e.fees && e.fees.length),
    JSON.stringify(r.data.events.map((e) => e.id + "=" + e.cost))
  );

  r = await req("/api/applications", { method: "POST", token: memberToken, body: { eventId: "adult", teamName: "Kingston Old Timers", contactName: "Jane Doe", email: memberEmail, division: "Men's C", teams: 3 } });
  check(
    "calculates total and 40% deposit (3 x $1,500, $600 deposit)",
    r.status === 201 && r.data.application.total === 4500 && r.data.application.depositDue === 1800,
    JSON.stringify({ total: r.data.application && r.data.application.total, depositDue: r.data.application && r.data.application.depositDue })
  );

  console.log("\nPermissions");
  r = await req("/api/admin/applications", { token: memberToken });
  check("member cannot read admin list", r.status === 403, "got " + r.status);

  r = await req("/api/applications/" + appId, { method: "PATCH", token: memberToken, body: { status: "confirmed" } });
  check("member cannot set status", r.status === 403, "got " + r.status);

  console.log("\nAdmin");
  r = await req("/api/auth/signup", { method: "POST", body: { name: "Ryan Admin", email: adminEmail, password: adminPass } });
  let adminToken = r.data && r.data.token;
  check("admin email signs up", r.status === 201 && r.data.user.role === "admin", JSON.stringify(r.data));
  if (!adminToken) {
    r = await req("/api/auth/login", { method: "POST", body: { email: adminEmail, password: adminPass } });
    adminToken = r.data && r.data.token;
    check("admin email logs in instead", r.status === 200, "got " + r.status);
  }

  r = await req("/api/admin/applications", { token: adminToken });
  check("admin sees all applications", r.status === 200 && r.data.applications.length >= 1 && r.data.applications[0].account, JSON.stringify(r.data).slice(0, 300));

  r = await req("/api/applications/" + appId, { method: "PATCH", token: adminToken, body: { status: "confirmed" } });
  check("admin confirms application", r.status === 200 && r.data.application.status === "confirmed", JSON.stringify(r.data));

  console.log("\nAdmin credential sign-in");
  r = await req("/api/admin/session");
  check("admin session rejects anonymous", r.status === 401, "got " + r.status);

  r = await req("/api/admin/session", { token: memberToken });
  check("admin session rejects members", r.status === 401, "got " + r.status);

  r = await req("/api/admin/login", { method: "POST", body: { email: adminEmail, password: "definitely-wrong" } });
  check("admin login rejects wrong password", r.status === 401, "got " + r.status);

  r = await req("/api/admin/login", { method: "POST", body: { email: "nobody@example.com", password: adminPass } });
  check("admin login rejects unknown email", r.status === 401, "got " + r.status);

  const envAdminPassword = process.env.ADMIN_PASSWORD_VALUE || "test-admin-password";
  r = await req("/api/admin/login", { method: "POST", body: { email: adminEmail, password: envAdminPassword } });
  check(
    "admin login issues an admin session",
    r.status === 200 && r.data.token && r.data.user.role === "admin",
    JSON.stringify({ status: r.status, role: r.data.user && r.data.user.role })
  );
  const envAdminToken = r.data && r.data.token;

  if (envAdminToken) {
    r = await req("/api/admin/session", { token: envAdminToken });
    check("admin session accepts the env administrator", r.status === 200 && r.data.user.role === "admin", "got " + r.status);

    r = await req("/api/admin/applications", { token: envAdminToken });
    check("env administrator can read applications", r.status === 200 && Array.isArray(r.data.applications), "got " + r.status);
  }

  r = await req("/api/auth/login", { method: "POST", body: { email: adminEmail, password: envAdminPassword } });
  check("admin account is not reachable through the public login", r.status === 401, "got " + r.status);

  console.log("\nWithdraw");
  r = await req("/api/applications/" + appId, { method: "DELETE", token: memberToken });
  check("member withdraws application", r.status === 200, "got " + r.status);

  r = await req("/api/applications", { token: memberToken });
  const withdrawn = (r.data.applications || []).find((a) => a.eventId === "bmha");
  check("withdrawn entry keeps history", r.status === 200 && withdrawn && withdrawn.status === "withdrawn", JSON.stringify(r.data).slice(0, 200));

  r = await req("/api/events");
  const bmha2 = r.data.events.find((e) => e.id === "bmha");
  check("withdrawn entry frees the count", bmha2.registeredTeams === 0, "got " + bmha2.registeredTeams);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("Test run crashed:", err.message);
  process.exit(2);
});
