// Starts the built CLI on a free port with a throwaway config, checks that /api/snapshot answers
// with JSON, and stops it. CI runs it on Linux, macOS and Windows after `pnpm build`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STARTUP_TIMEOUT_MS = 20_000;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-smoke-"));
const configPath = path.join(scratch, "config.json");
fs.writeFileSync(
  configPath,
  JSON.stringify({ openBrowser: false, startProxy: false, registerStudioAlias: false }),
);

const child = spawn(
  process.execPath,
  ["dist/cli/index.js", "--no-open", "--no-register", "--port", "0"],
  {
    env: {
      ...process.env,
      PORTLESS_STUDIO_CONFIG: configPath,
      PORTLESS_STATE_DIR: path.join(scratch, "portless"),
      // A missing binary keeps the smoke test from touching a real portless install.
      PORTLESS_BIN: path.join(scratch, "no-portless"),
      // The smoke test must not ask the npm registry for updates, in CI or on a laptop.
      PORTLESS_STUDIO_NO_UPDATE_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
});
child.stderr.on("data", (chunk) => {
  output += chunk;
});

function stop() {
  if (child.exitCode === null && child.signalCode === null) child.kill();
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function fail(message) {
  console.error(`smoke: ${message}\n--- server output ---\n${output}`);
  stop();
  process.exit(1);
}

async function waitForUrl() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) return match[0];
    if (child.exitCode !== null) fail(`the server exited with code ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return fail(`no URL printed within ${STARTUP_TIMEOUT_MS} ms`);
}

const baseUrl = await waitForUrl();
const response = await fetch(`${baseUrl}/api/snapshot`);
if (!response.ok) fail(`GET /api/snapshot answered ${response.status}`);
const snapshot = await response.json();
if (typeof snapshot !== "object" || snapshot === null || !Array.isArray(snapshot.routes)) {
  fail(`GET /api/snapshot did not return a snapshot: ${JSON.stringify(snapshot).slice(0, 200)}`);
}
console.log(`smoke: ${baseUrl}/api/snapshot answered with ${snapshot.routes.length} routes`);
stop();
