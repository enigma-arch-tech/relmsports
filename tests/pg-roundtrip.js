/* Round-trips the Postgres store against a live database to prove that
   accounts and applications survive a read-back with the exact field names
   core.js and the client use. Needs DATABASE_URL set (loads .env). */
"use strict";

require("../lib/env");
const crypto = require("crypto");
const pgStore = require("../lib/store-pg");

(async () => {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL not set — skipping Postgres round-trip");
    process.exit(0);
  }

  const userId = crypto.randomUUID();
  const appId = crypto.randomUUID();
  const stamp = Date.now();
  const now = new Date().toISOString();

  const user = {
    id: userId,
    name: "PG Round Trip",
    email: "pg.roundtrip." + stamp + "@example.com",
    salt: "abc123",
    passwordHash: "deadbeef",
    role: "member",
    createdAt: now
  };

  const application = {
    id: appId,
    userId: userId,
    eventId: "bmha",
    teamName: "Kingston Ice",
    contactName: "Jane Doe",
    email: user.email,
    division: "U13A",
    teams: 2,
    notes: "round trip",
    status: "pending",
    currency: "CAD",
    costPerTeam: 1975,
    total: 3950,
    depositDue: 1580,
    createdAt: now,
    updatedAt: now
  };

  let pass = 0;
  let fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log("  PASS  " + name); }
    else { fail++; console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); }
  };

  await pgStore.writeCollection("users", [user]);
  const users = await pgStore.readCollection("users");
  const readUser = users.find((u) => u.id === userId);
  check("user round-trips", !!readUser, "not found");
  check("user keeps camelCase fields", readUser && readUser.passwordHash === "deadbeef" && readUser.role === "member", JSON.stringify(readUser));

  await pgStore.writeCollection("applications", [application]);
  const apps = await pgStore.readCollection("applications");
  const readApp = apps.find((a) => a.id === appId);
  check("application round-trips", !!readApp, "not found");
  check(
    "application.total survives as `total`",
    readApp && readApp.total === 3950,
    JSON.stringify({ total: readApp && readApp.total, keys: readApp && Object.keys(readApp) })
  );
  check(
    "application pricing fields survive",
    readApp && readApp.costPerTeam === 1975 && readApp.depositDue === 1580 && readApp.division === "U13A",
    JSON.stringify(readApp)
  );

  // Update in place (status change, as an admin would) then re-read.
  readApp.status = "confirmed";
  const all = await pgStore.readCollection("applications");
  const next = all.map((a) => (a.id === appId ? readApp : a));
  await pgStore.writeCollection("applications", next);
  const after = (await pgStore.readCollection("applications")).find((a) => a.id === appId);
  check("status update persists", after && after.status === "confirmed", "got " + (after && after.status));

  // Adding a second user must not wipe the first (the DELETE-all trap).
  const second = Object.assign({}, user, { id: crypto.randomUUID(), email: "pg.roundtrip2." + stamp + "@example.com" });
  await pgStore.writeCollection("users", [readUser, second]);
  const users2 = await pgStore.readCollection("users");
  check("second user insert keeps the first", users2.some((u) => u.id === userId) && users2.some((u) => u.id === second.id), "count=" + users2.length);

  // Clean up the rows this test created.
  await pgStore.writeCollection("applications", (await pgStore.readCollection("applications")).filter((a) => a.id !== appId));
  await pgStore.writeCollection("users", (await pgStore.readCollection("users")).filter((u) => u.id !== userId && u.id !== second.id));

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error("pg round-trip crashed:", err.message);
  process.exit(2);
});
