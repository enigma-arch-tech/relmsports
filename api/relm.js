/* ==========================================================================
   RELM Sports — Vercel serverless entry (api/relm.js)

   Vercel builds every file in api/ as a serverless function. This one simply
   re-exports the shared request handler from ../server.js, so the exact same
   code answers /api/* locally (`node server.js`) and in production.

   Why a separate entry instead of using server.js directly?
     • server.js is the local HTTP listener entry point; keeping it out of api/
       means Vercel serves the static site natively (no `builds` step) and only
       /api/* runs as a function.
     • vercel.json rewrites /api/* to this file and passes the original
       sub-path in ?__p= (see the comment in server.js).

   Everything the handler needs — lib/** and data/events.json — is pulled in by
   Node's dependency tracing because this file requires server.js, which
   requires them. No includeFiles configuration is needed.
   ========================================================================== */

"use strict";

module.exports = require("../server.js");
