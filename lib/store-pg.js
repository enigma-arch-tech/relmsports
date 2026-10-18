/* ==========================================================================
   RELM Sports — PostgreSQL-backed storage layer
   Uses Neon/pg via node-postgres. Falls back to existing store if unavailable.
   ========================================================================== */

"use strict";

let USE_PG = !!process.env.DATABASE_URL;
let pool = null;

async function initPool() {
  if (pool || !USE_PG) return;
  try {
    const pg = require("pg");
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    // Ensure schema exists
    await pool.query(`
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
        user_id UUID NOT NULL REFERENCES users(id),
        event_id TEXT NOT NULL,
        team_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT NOT NULL,
        division TEXT NOT NULL,
        teams INTEGER NOT NULL,
        notes TEXT,
        status TEXT NOT NULL,
        currency TEXT NOT NULL,
        cost_per_team NUMERIC,
        total NUMERIC,
        deposit_due NUMERIC,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
      CREATE INDEX IF NOT EXISTS idx_applications_event_division ON applications(event_id, division);
    `);
  } catch (err) {
    pool = null;
    USE_PG = false;
    console.error("[store-pg] init failed, falling back:", err.message);
  }
}

function maybeInit() {
  if (USE_PG && !pool) initPool();
}

async function readCollection(name) {
  await maybeInit();
  if (pool) {
    if (name === "users") {
      const { rows } = await pool.query("SELECT id, name, email, salt, password_hash as \"passwordHash\", role, created_at as \"createdAt\" FROM users ORDER BY created_at ASC");
      return rows;
    } else if (name === "applications") {
      const { rows } = await pool.query("SELECT id, user_id as \"userId\", event_id as \"eventId\", team_name as \"teamName\", contact_name as \"contactName\", email, division, teams, notes, status, currency, cost_per_team as \"costPerTeam\", total, deposit_due as \"depositDue\", created_at as \"createdAt\", updated_at as \"updatedAt\" FROM applications ORDER BY created_at DESC");
      return rows;
    }
  }
  const store = require("./store");
  return store.readCollection(name);
}

async function writeCollection(name, value) {
  await maybeInit();
  if (pool && Array.isArray(value)) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (name === "users") {
        await client.query("DELETE FROM users");
        for (let i = 0; i < value.length; i++) {
          const u = value[i];
          await client.query(
            "INSERT INTO users(id,name,email,salt,password_hash,role,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [u.id, u.name, u.email, u.salt, u.passwordHash, u.role, u.createdAt]
          );
        }
      } else if (name === "applications") {
        await client.query("DELETE FROM applications");
        for (let i = 0; i < value.length; i++) {
          const a = value[i];
          await client.query(
            "INSERT INTO applications(id,user_id,event_id,team_name,contact_name,email,division,teams,notes,status,currency,cost_per_team,total,deposit_due,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
            [
              a.id,
              a.userId,
              a.eventId,
              a.teamName,
              a.contactName,
              a.email,
              a.division,
              a.teams,
              a.notes || null,
              a.status,
              a.currency,
              a.costPerTeam || 0,
              a.total || 0,
              a.depositDue || 0,
              a.createdAt,
              a.updatedAt
            ]
          );
        }
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    return;
  }
  const store = require("./store");
  return store.writeCollection(name, value);
}

module.exports = {
  readCollection,
  writeCollection,
  readEvents: function() { return require("./store").readEvents(); },
  getSecret: function() { return require("./store").getSecret(); },
  ensureData: function() { return require("./store").ensureData(); },
  USE_PG
};
