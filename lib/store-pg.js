/* ==========================================================================
   RELM Sports — PostgreSQL-backed storage layer
   Uses Neon/pg via node-postgres. Any failure throws back to store.js,
   which falls back to KV → filesystem → memory (never delegates back here,
   so there is no recursion between store.js and this module).
   ========================================================================== */

"use strict";

const USE_PG = !!process.env.DATABASE_URL;
let pool = null;
let initPromise = null;

function init() {
  if (!USE_PG) return Promise.resolve(null);
  if (!initPromise) {
    initPromise = (async function () {
      try {
        const pg = require("pg");
        const p = new pg.Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
        // Ensure schema exists before the first query runs. ADD COLUMN IF NOT
        // EXISTS keeps this compatible with tables created by older versions.
        await p.query(`
          CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at TIMESTAMPTZ NOT NULL
          );
          CREATE TABLE IF NOT EXISTS applications (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_id TEXT NOT NULL,
            team_name TEXT NOT NULL,
            contact_name TEXT NOT NULL,
            email TEXT NOT NULL,
            division TEXT NOT NULL,
            teams INTEGER NOT NULL,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            currency TEXT NOT NULL DEFAULT 'CAD',
            cost_per_team NUMERIC,
            total NUMERIC,
            deposit_due NUMERIC,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          );
          ALTER TABLE applications ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'CAD';
          ALTER TABLE applications ADD COLUMN IF NOT EXISTS total NUMERIC;
          ALTER TABLE applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
          CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
          CREATE INDEX IF NOT EXISTS idx_applications_event ON applications(event_id);
        `);
        pool = p;
        return p;
      } catch (err) {
        initPromise = null; /* allow a retry on the next request */
        throw err;
      }
    })();
  }
  return initPromise;
}

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    salt: row.salt,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at
  };
}

function toApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    eventId: row.event_id,
    teamName: row.team_name,
    contactName: row.contact_name,
    email: row.email,
    division: row.division,
    teams: row.teams,
    notes: row.notes || "",
    status: row.status,
    currency: row.currency || "CAD",
    costPerTeam: row.cost_per_team == null ? null : Number(row.cost_per_team),
    total: row.total == null ? null : Number(row.total),
    depositDue: row.deposit_due == null ? null : Number(row.deposit_due),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

async function readCollection(name) {
  const p = await init();
  if (!p) throw new Error("Postgres unavailable");

  if (name === "users") {
    const res = await p.query('SELECT * FROM users ORDER BY created_at ASC');
    return res.rows.map(toUser);
  }
  if (name === "applications") {
    const res = await p.query('SELECT * FROM applications ORDER BY created_at DESC');
    return res.rows.map(toApplication);
  }
  return [];
}

/* Full-collection write, implemented as per-row UPSERT + removal of rows that
   disappeared from the list. Never DELETE-all + re-INSERT: applications have an
   FK to users, so a blanket DELETE FROM users would roll back as soon as any
   application exists. */
async function writeCollection(name, value) {
  const p = await init();
  if (!p) throw new Error("Postgres unavailable");
  const rows = Array.isArray(value) ? value : [];
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    if (name === "users") {
      for (const u of rows) {
        await client.query(
          `INSERT INTO users (id, name, email, salt, password_hash, role, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             salt = EXCLUDED.salt,
             password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             created_at = EXCLUDED.created_at`,
          [String(u.id), u.name, String(u.email).toLowerCase(), u.salt, u.passwordHash,
           u.role || "member", u.createdAt || new Date().toISOString()]
        );
      }
      const ids = rows.map(function (u) { return String(u.id); });
      if (ids.length) {
        await client.query(
          "DELETE FROM users WHERE NOT (id = ANY($1::uuid[])) AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = users.id)",
          [ids]
        );
      } else {
        await client.query(
          "DELETE FROM users WHERE NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = users.id)"
        );
      }
    } else if (name === "applications") {
      for (const a of rows) {
        await client.query(
          `INSERT INTO applications
             (id, user_id, event_id, team_name, contact_name, email, division, teams,
              notes, status, currency, cost_per_team, total, deposit_due, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             event_id = EXCLUDED.event_id,
             team_name = EXCLUDED.team_name,
             contact_name = EXCLUDED.contact_name,
             email = EXCLUDED.email,
             division = EXCLUDED.division,
             teams = EXCLUDED.teams,
             notes = EXCLUDED.notes,
             status = EXCLUDED.status,
             currency = EXCLUDED.currency,
             cost_per_team = EXCLUDED.cost_per_team,
             total = EXCLUDED.total,
             deposit_due = EXCLUDED.deposit_due,
             updated_at = EXCLUDED.updated_at`,
          [String(a.id), String(a.userId), String(a.eventId), a.teamName, a.contactName,
           String(a.email).toLowerCase(), a.division, Number(a.teams) || 1,
           a.notes || "", a.status || "pending", a.currency || "CAD",
           a.costPerTeam == null ? null : Number(a.costPerTeam),
           a.total == null ? null : Number(a.total),
           a.depositDue == null ? null : Number(a.depositDue),
           a.createdAt || new Date().toISOString(),
           a.updatedAt || a.createdAt || new Date().toISOString()]
        );
      }
      const ids = rows.map(function (a) { return String(a.id); });
      if (ids.length) {
        await client.query("DELETE FROM applications WHERE NOT (id = ANY($1::uuid[]))", [ids]);
      } else {
        await client.query("DELETE FROM applications");
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (e) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function getSecret() {
  return null; /* store.js handles secrets (env KV file) */
}

async function ensureData() {
  /* schema is created in init() */
}

module.exports = { USE_PG, readCollection, writeCollection, getSecret, ensureData };
