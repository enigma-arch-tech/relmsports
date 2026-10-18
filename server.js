/* ==========================================================================
   RELM Sports — Node server + Vercel Serverless Function (server.js)

   Zero dependencies. Run locally with:  node server.js

   This file is the entry point. It wires together the shared modules in lib/:

     lib/env.js     loads a project-local .env (if any)
     lib/store.js   storage: Vercel KV / Upstash Redis → filesystem → memory
     lib/core.js    the JSON API router (accounts, applications, admin)

   It serves the static site and answers /api/* through lib/core.js. The same
   module is used two ways:
     • locally           → `node server.js` starts an HTTP listener
     • on Vercel         → vercel.json builds this file with @vercel/node and
                           routes every request to it (the module's exported
                           function is used as the request handler)
   ========================================================================== */

"use strict";

require("./lib/env");

const http = require("http");
const fs = require("fs");
const path = require("path");

const core = require("./lib/core");
const store = require("./lib/store");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

/* ----------------------------------------------------------- static files -- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};

// Files and folders that must never be served over HTTP.
const BLOCKED_FILES = {
  "server.js": true,
  "package.json": true,
  "package-lock.json": true,
  "vercel.json": true,
  "README.md": true,
  ".env": true,
  ".env.example": true,
  ".gitignore": true,
  ".vercelignore": true
};
const BLOCKED_DIRS = {
  data: true,
  tests: true,
  lib: true,
  api: true,
  node_modules: true,
  ".git": true,
  ".vercel": true
};

/* --------------------------------------------------------------- helpers -- */

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function parseMaybeJson(value) {
  if (value === undefined || value === null) return {};
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    const raw = Buffer.isBuffer(value) ? value.toString("utf8") : value;
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch (err) {
      return {};
    }
  }
  if (typeof value === "object") return value;
  return {};
}

function readBodyJson(req) {
  // Vercel's Node runtime may expose an already-parsed body on req.body
  // (an object, a JSON string, or a Buffer, depending on the content-type).
  if (req.body !== undefined && req.body !== null) {
    return Promise.resolve(parseMaybeJson(req.body));
  }

  // Only requests that can carry a body need to be read from the stream.
  if (["POST", "PATCH", "PUT"].indexOf(String(req.method || "").toUpperCase()) === -1) {
    return Promise.resolve({});
  }
  if (typeof req.on !== "function") return Promise.resolve({});

  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function isBlocked(target) {
  if (!target.startsWith(ROOT)) return true;
  const rel = path.relative(ROOT, target).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..")) return true;
  const first = rel.split("/")[0];
  if (BLOCKED_DIRS[first]) return true;
  if (rel === first && BLOCKED_FILES[rel]) return true;
  if (/^\.env(\.|$)/.test(rel.split("/").pop())) return true;
  return false;
}

function serveStatic(res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch (err) {
    rel = url.pathname;
  }
  if (rel === "/") rel = "/index.html";

  const target = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ""));

  if (isBlocked(target)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  fs.stat(target, function (err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(
        '<!DOCTYPE html><meta charset="utf-8"><title>Not found</title>' +
          '<div style="font:16px/1.6 Barlow,sans-serif;padding:60px;text-align:center">' +
          "<h1 style=\"font-family:Orbitron,sans-serif\">404</h1><p>That page does not exist. " +
          '<a href="/index.html">Back to the homepage</a>.</p></div>'
      );
    }

    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    fs.createReadStream(target).pipe(res);
  });
}

/* ---------------------------------------------------------------- handler -- */

async function handler(req, res) {
  let url;
  try {
    url = new URL(req.url || "/", "http://localhost");
  } catch (err) {
    url = new URL("/", "http://localhost");
  }

  // On Vercel every /api/* request is rewritten to the API entry (api/relm.js).
  // A rewrite replaces the request path, so vercel.json forwards the original
  // sub-path in ?__p=. Unwrap it so the router keeps seeing /api/<...>.
  let pathname = url.pathname;
  if (pathname === "/api/relm") {
    const sub = url.searchParams.get("__p") || "";
    pathname = sub ? "/api/" + sub.replace(/^\/+/, "") : "/api";
  }

  // API requests are answered by the shared core in lib/core.js.
  if (pathname === "/api" || pathname.indexOf("/api/") === 0) {
    try {
      const body = await readBodyJson(req);
      const result = await core.handle({
        method: req.method,
        pathname: pathname,
        headers: req.headers,
        body: body
      });
      return sendJson(res, result.status, result.body);
    } catch (err) {
      return sendJson(res, 500, { error: err.message || "Server error" });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method not allowed");
  }

  return serveStatic(res, url);
}

/* =========================================================================
   EXPORT + LOCAL LISTENER
   On Vercel the file is required and `handler` is used directly.
   Locally `node server.js` starts the listener below.
   ========================================================================= */

module.exports = handler;
module.exports.handler = handler;

function startServer() {
  store.ensureData();
  http.createServer(handler).listen(PORT, function () {
    console.log("");
    console.log("  RELM Sports replica is running");
    console.log("  ------------------------------------------------");
    console.log("  Site:    http://localhost:" + PORT + "/");
    console.log("  Account: http://localhost:" + PORT + "/account.html");
    console.log("  Admin:   http://localhost:" + PORT + "/admin.html");
    console.log("");
    console.log("  Storage: " + (store.USE_KV ? "Vercel KV / Upstash Redis" : store.DATA_DIR));
    console.log("  Admin accounts: " + core.ADMIN_EMAILS.join(", "));
    console.log("");
  });
}

if (require.main === module) {
  startServer();
}
