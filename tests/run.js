/* Starts an isolated copy of the server (random port, throwaway data folder)
   and runs tests/e2e.js against it, so real accounts are never touched.
   Run with:  node tests/run.js   (or  npm test )  */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relm-test-"));
fs.copyFileSync(path.join(ROOT, "data", "events.json"), path.join(tmp, "events.json"));

const PORT = 3100 + Math.floor(Math.random() * 500);
const env = Object.assign({}, process.env, {
  PORT: String(PORT),
  RELM_DATA_DIR: tmp,
  ADMIN_EMAILS: "admin@test.local",
  SECRET: "relm-tests-only-secret"
});

const server = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: env, stdio: "ignore" });

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  try { server.kill(); } catch (err) { /* ignore */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  process.exit(code);
}

async function waitReady() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:" + PORT + "/api/events");
      if (res.ok) return true;
    } catch (err) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

(async () => {
  if (!(await waitReady())) {
    console.error("test server did not start on port " + PORT);
    finish(2);
    return;
  }

  console.log("test server up on " + PORT + " (data dir: " + tmp + ")");

  const child = spawn(process.execPath, [path.join(__dirname, "e2e.js")], {
    cwd: ROOT,
    env: Object.assign({}, env, { BASE: "http://localhost:" + PORT, ADMIN_EMAIL: "admin@test.local" }),
    stdio: "inherit"
  });

  child.on("exit", (code) => finish(code || 0));
})().catch((err) => {
  console.error("runner crashed:", err.message);
  finish(2);
});
