/* ==========================================================================
   RELM Sports — storage layer (lib/store.js)

   One small interface used by lib/core.js (the API router) and server.js.
   Accounts and applications live in, in order of preference:

     1. Upstash Redis / Vercel KV  — when KV_REST_API_* or
        UPSTASH_REDIS_REST_* env vars are present (the only durable option on
        Vercel).
     2. The filesystem             — locally in ./data, or in the OS temp
        directory on Vercel, which persists for the life of a warm function
        instance but is otherwise ephemeral.
     3. An in-memory cache         — automatic fallback if the disk is
        read-only, so the instance keeps working instead of throwing.

   Tournament definitions (data/events.json) are read-only content and are
   `require`d statically so the serverless bundler always ships them.
   ========================================================================== */

"use strict";

require("./env");

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_DATA_DIR = path.join(ROOT, "data");

// Required (not read with fs) so the Vercel bundler always ships it.
let BUNDLED_EVENTS = [];
try {
  BUNDLED_EVENTS = require("../data/events.json");
} catch (err) {
  BUNDLED_EVENTS = [];
}

const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME
);

const DATA_DIR = (function resolveDataDir() {
  if (process.env.RELM_DATA_DIR) return path.resolve(process.env.RELM_DATA_DIR);
  if (IS_SERVERLESS) return path.join(os.tmpdir(), "relm-data");
  return PROJECT_DATA_DIR;
})();

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const USE_KV = Boolean(KV_URL && KV_TOKEN);

// PostgreSQL via DATABASE_URL takes highest priority
let USE_PG = !!process.env.DATABASE_URL;
let pgStore = null;
function getPg() {
  if (!USE_PG) return null;
  if (pgStore) return pgStore;
  try {
    pgStore = require("./store-pg");
    USE_PG = !!pgStore;
    return pgStore;
  } catch (err) {
    USE_PG = false;
    return null;
  }
}

// In-memory fallback so the app keeps working when nothing can be persisted.
const memory = { users: null, applications: null };
let cachedSecret = null;

/* -------------------------------------------------------------- key-value -- */

async function kv(command) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + KV_TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error("Storage request failed (" + res.status + ")");
  const data = await res.json();
  if (data && data.error) throw new Error("Storage error: " + data.error);
  return data ? data.result : null;
}

/* ------------------------------------------------------------- filesystem -- */

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, name + ".json");
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (err) {
    return fallback;
  }
}

function writeJsonFile(file, value) {
  ensureDir();
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/* -------------------------------------------------------------- collections */

async function readCollection(name) {
  const pg = getPg();
  if (pg && pg.readCollection) {
    try { return await pg.readCollection(name); } catch (e) {}
  }
  if (USE_KV) {
    const raw = await kv(["GET", "relm:" + name]);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }
  if (Array.isArray(memory[name])) return memory[name];
  const parsed = readJsonFile(filePath(name), null);
  return Array.isArray(parsed) ? parsed : [];
}

async function writeCollection(name, value) {
  const pg = getPg();
  if (pg && pg.writeCollection) {
    try { await pg.writeCollection(name, value); return; } catch (e) {}
  }
  if (USE_KV) {
    await kv(["SET", "relm:" + name, JSON.stringify(value)]);
    return;
  }
  // Always keep a copy in memory first.
  memory[name] = value;
  try {
    writeJsonFile(filePath(name), value);
  } catch (err) {
    // Read-only filesystem (some serverless runtimes): the in-memory copy
    // above keeps the current instance fully functional.
  }
}

/* -------------------------------------------------------------------- events */

function readEvents() {
  // Look in every place the file could legitimately live, in order of
  // preference. On Vercel the writable DATA_DIR (/tmp/relm-data) is usually
  // empty, so we fall back to the copy that ships inside the function bundle
  // (ROOT/data, traced from the `require` below) and finally to that
  // `require`d copy itself.
  const candidates = [
    path.join(DATA_DIR, "events.json"),
    path.join(ROOT, "data", "events.json"),
    path.join(PROJECT_DATA_DIR, "events.json")
  ];
  for (const file of candidates) {
    const parsed = readJsonFile(file, null);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  }
  return BUNDLED_EVENTS;
}

/* -------------------------------------------------------------------- secret */

async function getSecret() {
  if (process.env.SECRET) return Buffer.from(process.env.SECRET, "utf8");
  if (cachedSecret) return cachedSecret;

  if (USE_KV) {
    let value = await kv(["GET", "relm:secret"]);
    if (!value) {
      value = crypto.randomBytes(32).toString("hex");
      await kv(["SET", "relm:secret", value]);
    }
    cachedSecret = Buffer.from(value, "utf8");
    return cachedSecret;
  }

  const file = path.join(DATA_DIR, ".secret");
  try {
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      if (buf.length) {
        cachedSecret = buf;
        return cachedSecret;
      }
    }
  } catch (err) {
    /* fall through and generate one */
  }

  const secret = crypto.randomBytes(32);
  cachedSecret = secret;
  try {
    ensureDir();
    fs.writeFileSync(file, secret, { mode: 0o600 });
  } catch (err) {
    /* read-only filesystem — the secret lives in memory for this instance */
  }
  return secret;
}

/* ------------------------------------------------------------------ startup */

function ensureData() {
  if (USE_KV) return;
  try {
    ensureDir();
    if (!fs.existsSync(filePath("users"))) fs.writeFileSync(filePath("users"), "[]\n");
    if (!fs.existsSync(filePath("applications"))) fs.writeFileSync(filePath("applications"), "[]\n");
  } catch (err) {
    /* nothing writable — memory fallback covers it */
  }
}

module.exports = {
  ROOT: ROOT,
  PROJECT_DATA_DIR: PROJECT_DATA_DIR,
  DATA_DIR: DATA_DIR,
  USE_KV: USE_KV,
  USE_PG: USE_PG,
  IS_SERVERLESS: IS_SERVERLESS,
  readCollection: readCollection,
  writeCollection: writeCollection,
  readEvents: readEvents,
  getSecret: getSecret,
  ensureData: ensureData
};
