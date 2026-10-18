/* ==========================================================================
   RELM Sports — shared API core (lib/core.js)

   A tiny, runtime-agnostic router. It is invoked by the local server
   (node server.js) and by the Vercel serverless function alike, so the two
   can never drift apart.

   handle({ method, pathname, headers, body }) -> Promise<{ status, body }>
   ========================================================================== */

"use strict";

require("./env");

const crypto = require("crypto");
const store = require("./store");

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "relmtournaments@outlook.com")
  .split(",")
  .map(function (email) {
    return email.trim().toLowerCase();
  })
  .filter(Boolean);

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/* ------------------------------------------------------------- primitives -- */

function str(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 240);
}

function isEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, user) {
  try {
    const expected = Buffer.from(user.passwordHash, "hex");
    const actual = crypto.scryptSync(password, user.salt, 64);
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch (err) {
    return false;
  }
}

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(user) {
  const payload = b64url(JSON.stringify({ uid: user.id, exp: Date.now() + TOKEN_TTL_MS }));
  const secret = await store.getSecret();
  const sig = b64url(crypto.createHmac("sha256", secret).update(payload).digest());
  return payload + "." + sig;
}

async function verifyToken(token) {
  if (!token || typeof token !== "string" || token.indexOf(".") === -1) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payload = parts[0];
  const sig = parts[1];

  let expected;
  try {
    const secret = await store.getSecret();
    expected = b64url(crypto.createHmac("sha256", secret).update(payload).digest());
  } catch (err) {
    return null;
  }

  const a = Buffer.from(sig || "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    );
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (err) {
    return null;
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || "member",
    createdAt: user.createdAt
  };
}

function bearer(headers) {
  const h = headers || {};
  const header = h.authorization || h.Authorization || "";
  return String(header).replace(/^Bearer\s+/i, "").trim();
}

async function currentUser(headers) {
  const data = await verifyToken(bearer(headers));
  if (!data) return null;
  const users = await store.readCollection("users");
  return (
    users.find(function (u) {
      return u.id === data.uid;
    }) || null
  );
}

function reply(status, body) {
  return { status: status, body: body };
}

/* ----------------------------------------------------------------- router -- */

async function handle(request) {
  const req = request || {};
  const method = String(req.method || "GET").toUpperCase();
  const pathname = String(req.pathname || "");
  const headers = req.headers || {};
  const body = req.body && typeof req.body === "object" ? req.body : {};

  const segments = pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const route = segments.join("/");

  /* ------------------------------------------------------ GET /api/events */
  if (route === "events" && method === "GET") {
    const events = store.readEvents();
    const apps = await store.readCollection("applications");
    const withCounts = events.map(function (event) {
      const count = apps.filter(function (a) {
        return a.eventId === event.id && a.status !== "withdrawn";
      }).length;
      return Object.assign({}, event, { registeredTeams: count });
    });
    return reply(200, { events: withCounts });
  }

  /* -------------------------------------------------- POST /api/auth/signup */
  if (route === "auth/signup" && method === "POST") {
    const name = str(body.name, 80);
    const email = str(body.email, 160).toLowerCase();
    const password = String(body.password || "");

    const errors = {};
    if (name.length < 2) errors.name = "Please enter your full name.";
    if (!isEmail(email)) errors.email = "Please enter a valid email address.";
    if (password.length < 8) errors.password = "Password must be at least 8 characters.";
    if (Object.keys(errors).length) return reply(400, { errors: errors });

    const users = await store.readCollection("users");
    if (users.some(function (u) { return u.email === email; })) {
      return reply(409, { errors: { email: "An account with that email already exists." } });
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const user = {
      id: crypto.randomUUID(),
      name: name,
      email: email,
      salt: salt,
      passwordHash: hashPassword(password, salt),
      role: ADMIN_EMAILS.indexOf(email) > -1 ? "admin" : "member",
      createdAt: new Date().toISOString()
    };

    users.push(user);
    await store.writeCollection("users", users);

    return reply(201, { user: publicUser(user), token: await signToken(user) });
  }

  /* --------------------------------------------------- POST /api/auth/login */
  if (route === "auth/login" && method === "POST") {
    const email = str(body.email, 160).toLowerCase();
    const password = String(body.password || "");
    const users = await store.readCollection("users");
    const user = users.find(function (u) { return u.email === email; });

    if (!user || !verifyPassword(password, user)) {
      return reply(401, {
        errors: { form: "That email and password combination does not match an account." }
      });
    }

    return reply(200, { user: publicUser(user), token: await signToken(user) });
  }

  /* ------------------------------------------------------ GET /api/auth/me */
  if (route === "auth/me" && method === "GET") {
    const user = await currentUser(headers);
    if (!user) return reply(401, { error: "Not signed in" });
    return reply(200, { user: publicUser(user) });
  }

  /* -------------------------------------------------- POST /api/auth/logout */
  if (route === "auth/logout" && method === "POST") {
    // Tokens are stateless; the client simply discards it.
    return reply(200, { ok: true });
  }

  /* ----------------------------------------------- GET /api/applications */
  if (route === "applications" && method === "GET") {
    const user = await currentUser(headers);
    if (!user) return reply(401, { error: "Not signed in" });

    const events = store.readEvents();
    const applications = (await store.readCollection("applications"))
      .filter(function (a) { return a.userId === user.id; })
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
      .map(function (a) {
        return Object.assign({}, a, { event: events.find(function (e) { return e.id === a.eventId; }) || null });
      });

    return reply(200, { applications: applications });
  }

  /* ---------------------------------------------- POST /api/applications */
  if (route === "applications" && method === "POST") {
    const user = await currentUser(headers);
    if (!user) return reply(401, { error: "Sign in to submit an application." });

    const event = store.readEvents().find(function (e) { return e.id === str(body.eventId, 60); });
    if (!event) return reply(400, { errors: { eventId: "Choose a valid tournament." } });

    const fields = {
      teamName: str(body.teamName, 120),
      contactName: str(body.contactName, 120),
      email: str(body.email, 160).toLowerCase(),
      division: str(body.division, 80),
      teams: Number(body.teams) || 1,
      notes: str(body.notes, 800)
    };

    const errors = {};
    if (fields.teamName.length < 2) errors.teamName = "Team name is required.";
    if (fields.contactName.length < 2) errors.contactName = "Contact name is required.";
    if (!isEmail(fields.email)) errors.email = "A valid contact email is required.";
    if (!fields.division) errors.division = "Select the age group or division.";
    if (!(fields.teams >= 1 && fields.teams <= 20)) errors.teams = "Enter between 1 and 20 teams.";
    if (Object.keys(errors).length) return reply(400, { errors: errors });

    const apps = await store.readCollection("applications");
    const duplicate = apps.find(function (a) {
      return (
        a.userId === user.id &&
        a.eventId === event.id &&
        a.division === fields.division &&
        a.status !== "withdrawn"
      );
    });
    if (duplicate) {
      return reply(409, { errors: { form: "You already have an active application for that division." } });
    }

    const now = new Date().toISOString();
    const application = Object.assign(
      {
        id: crypto.randomUUID(),
        userId: user.id,
        eventId: event.id,
        status: "pending",
        currency: "CAD",
        costPerTeam: Number(event.cost) || 0,
        total: (Number(event.cost) || 0) * fields.teams,
        depositDue: (Number(event.deposit) || 0) * fields.teams,
        createdAt: now,
        updatedAt: now
      },
      fields
    );

    apps.push(application);
    await store.writeCollection("applications", apps);

    return reply(201, { application: Object.assign({}, application, { event: event }) });
  }

  /* ------------------------------ PATCH/DELETE /api/applications/:id */
  if (segments[0] === "applications" && segments[1]) {
    const user = await currentUser(headers);
    if (!user) return reply(401, { error: "Not signed in" });

    const apps = await store.readCollection("applications");
    const index = apps.findIndex(function (a) { return a.id === segments[1]; });
    if (index === -1) return reply(404, { error: "Application not found" });

    const application = apps[index];
    const isOwner = application.userId === user.id;
    const isAdmin = user.role === "admin";
    if (!isOwner && !isAdmin) return reply(403, { error: "Not allowed" });

    // Withdraw (owner or admin)
    if (method === "DELETE") {
      if (isOwner && !isAdmin) {
        apps[index].status = "withdrawn";
        apps[index].updatedAt = new Date().toISOString();
      } else {
        apps.splice(index, 1);
      }
      await store.writeCollection("applications", apps);
      return reply(200, { ok: true });
    }

    // Status update (admin only)
    if (method === "PATCH") {
      if (!isAdmin) return reply(403, { error: "Admins only" });
      const status = str(body.status, 20);
      if (["pending", "confirmed", "declined", "withdrawn"].indexOf(status) === -1) {
        return reply(400, { error: "Unknown status" });
      }
      apps[index].status = status;
      apps[index].updatedAt = new Date().toISOString();
      await store.writeCollection("applications", apps);
      return reply(200, { application: apps[index] });
    }
  }

  /* ------------------------------------ GET /api/admin/applications */
  if (route === "admin/applications" && method === "GET") {
    const user = await currentUser(headers);
    if (!user || user.role !== "admin") return reply(403, { error: "Admins only" });

    const events = store.readEvents();
    const users = await store.readCollection("users");
    const applications = (await store.readCollection("applications"))
      .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; })
      .map(function (a) {
        const account = users.find(function (u) { return u.id === a.userId; });
        return Object.assign({}, a, {
          event: events.find(function (e) { return e.id === a.eventId; }) || null,
          account: account ? { name: account.name, email: account.email } : null
        });
      });

    return reply(200, { applications: applications });
  }

  return reply(404, { error: "Unknown endpoint" });
}

module.exports = {
  handle: handle,
  routeApi: handle,
  ADMIN_EMAILS: ADMIN_EMAILS
};
