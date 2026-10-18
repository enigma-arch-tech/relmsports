/* ==========================================================================
   RELM Sports — environment loader (lib/env.js)
   Loads a project-local .env into process.env when one is present.

   On Vercel there is no .env file — variables come from the project dashboard
   — so the failure is ignored. Safe to `require` from any other module: it is
   idempotent and has no side effects beyond populating process.env.
   ========================================================================== */

"use strict";

const path = require("path");

let loaded = false;

try {
  if (typeof process.loadEnvFile === "function") {
    // .env lives in the project root, one level up from lib/
    process.loadEnvFile(path.join(__dirname, "..", ".env"));
    loaded = true;
  }
} catch (err) {
  // No .env file (or an older Node without loadEnvFile): inherit the process
  // environment as-is. This is the normal case on Vercel.
  loaded = false;
}

module.exports = { loaded: loaded };
