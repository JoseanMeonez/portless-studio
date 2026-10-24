import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parsePortlessVersion } from "./portless-cli.ts";
import { PortlessRegistry } from "./portless-registry.ts";

// Stands in for `portless alias`: same arguments, messages and exit codes, no proxy needed.
const FAKE_PORTLESS = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.env.PORTLESS_STATE_DIR, "routes.json");
const routes = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("\u001b[1mportless\u001b[22m v0.4.2");
  process.exit(0);
}
const save = (list) => fs.writeFileSync(file, JSON.stringify(list));
if (args[1] === "--remove") {
  const hostname = args[2] + ".localhost";
  if (!routes.some((r) => r.hostname === hostname && r.pid === 0)) {
    console.error('Error: No alias found for "' + hostname + '".');
    process.exit(1);
  }
  save(routes.filter((r) => r.hostname !== hostname));
} else {
  const hostname = args[1] + ".localhost";
  const existing = routes.find((r) => r.hostname === hostname);
  if (existing && !args.includes("--force")) {
    console.error('\\u001b[31mError:\\u001b[39m "' + hostname + '" is a static alias. Use --force to replace it.');
    process.exit(1);
  }
  save([...routes.filter((r) => r.hostname !== hostname), { hostname, port: Number(args[2]), pid: 0 }]);
  console.log("Alias registered: " + hostname);
}
`;

// Stands in for npm: accepts only `install -g portless`, then puts a portless binary at TARGET.
const fakeNpm = (target: string, mode: "ok" | "fail" | "slow") => `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2).join(" ");
if (args !== "install -g portless") {
  console.error("unexpected arguments: " + args);
  process.exit(2);
}
if (${JSON.stringify(mode)} === "fail") {
  console.log("npm http fetch GET 200 https://registry.npmjs.org/portless");
  console.error("\u001b[31mnpm error\u001b[39m code EACCES");
  process.exit(243);
}
const finish = () => {
  fs.writeFileSync(${JSON.stringify(target)}, "#!/bin/sh\\necho 1.2.3\\n", { mode: 0o755 });
  console.log("added 1 package in 2s");
};
if (${JSON.stringify(mode)} === "slow") setTimeout(finish, 300);
else finish();
`;

let dir: string;
let bin: string;
let stop: (() => void) | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
  bin = path.join(dir, "fake-portless.cjs");
  fs.writeFileSync(bin, FAKE_PORTLESS, { mode: 0o755 });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

const writeRoutes = (routes: unknown[]) =>
  fs.writeFileSync(path.join(dir, "routes.json"), JSON.stringify(routes));

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("PortlessRegistry", () => {
  it("reads routes and proxy status into one snapshot", async () => {
    writeRoutes([{ hostname: "db.localhost", port: 5432, pid: 0 }]);
    fs.writeFileSync(path.join(dir, "proxy.port"), "1355");
    const snapshot = await new PortlessRegistry({ stateDir: dir, bin }).readSnapshot();
    expect(snapshot.proxy).toEqual({
      running: false,
      port: 1355,
      https: false,
      tlds: ["localhost"],
    });
    expect(snapshot.routes.map((r) => r.url)).toEqual(["http://db.localhost:1355"]);
    expect(typeof snapshot.readAt).toBe("number");
  });

  it("notifies once per real change and not for rewrites of the same content", async () => {
    writeRoutes([]);
    const registry = new PortlessRegistry({ stateDir: dir, bin, debounceMs: 20, pollMs: 60_000 });
    const onChange = vi.fn();
    stop = registry.watch(onChange);

    writeRoutes([{ hostname: "db.localhost", port: 5432, pid: 0 }]);
    writeRoutes([{ hostname: "db.localhost", port: 5432, pid: 0 }]);
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    writeRoutes([{ hostname: "db.localhost", port: 5432, pid: 0 }]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("notices changes through polling when no file event arrives", async () => {
    const registry = new PortlessRegistry({
      stateDir: path.join(dir, "missing"),
      bin,
      pollMs: 30,
    });
    const onChange = vi.fn();
    stop = registry.watch(onChange);
    fs.mkdirSync(path.join(dir, "missing"));
    fs.writeFileSync(path.join(dir, "missing", "proxy.port"), "1355");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });

  posixOnly("creates and removes an alias through the portless binary", async () => {
    const registry = new PortlessRegistry({ stateDir: dir, bin });
    expect(await registry.createAlias("db", 5432, false)).toEqual({ ok: true, value: undefined });
    expect((await registry.readSnapshot()).routes.map((r) => r.name)).toEqual(["db"]);
    expect(await registry.removeAlias("db")).toEqual({ ok: true, value: undefined });
    expect((await registry.readSnapshot()).routes).toEqual([]);
  });

  posixOnly("maps a name conflict to name_taken without color codes", async () => {
    writeRoutes([{ hostname: "db.localhost", port: 5432, pid: 0 }]);
    const result = await new PortlessRegistry({ stateDir: dir, bin }).createAlias("db", 1, false);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "name_taken",
        message: '"db.localhost" is a static alias. Use --force to replace it.',
      },
    });
  });

  posixOnly("passes --force through", async () => {
    writeRoutes([{ hostname: "db.localhost", port: 5432, pid: 0 }]);
    const result = await new PortlessRegistry({ stateDir: dir, bin }).createAlias("db", 6543, true);
    expect(result.ok).toBe(true);
  });

  posixOnly("maps an unknown alias to not_found", async () => {
    const result = await new PortlessRegistry({ stateDir: dir, bin }).removeAlias("nope");
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("maps a missing binary to portless_unavailable", async () => {
    const registry = new PortlessRegistry({ stateDir: dir, bin: path.join(dir, "no-such-bin") });
    const result = await registry.createAlias("db", 5432, false);
    expect(result).toMatchObject({ ok: false, error: { code: "portless_unavailable" } });
  });

  posixOnly("reports the installed portless version in the snapshot", async () => {
    const snapshot = await new PortlessRegistry({ stateDir: dir, bin }).readSnapshot();
    expect(snapshot.portless).toEqual({ installed: true, version: "0.4.2" });
  });

  it("reports portless as missing when the binary does not exist", async () => {
    const registry = new PortlessRegistry({ stateDir: dir, bin: path.join(dir, "no-such-bin") });
    expect((await registry.readSnapshot()).portless).toEqual({ installed: false, version: null });
  });
});

describe("parsePortlessVersion", () => {
  it.each([
    ["0.4.2\n", "0.4.2"],
    ["portless v1.10.0-beta.1", "1.10.0-beta.1"],
    ["portless version 2.0.1 (darwin)", "2.0.1"],
    ["dev build\n", "dev build"],
    ["  \n", null],
  ])("reads %j as %j", (output, expected) => {
    expect(parsePortlessVersion(output)).toBe(expected);
  });
});

describe("PortlessRegistry.installPortless", () => {
  let target: string;
  let npmBin: string;

  const setup = (mode: "ok" | "fail" | "slow") => {
    target = path.join(dir, "installed-portless");
    npmBin = path.join(dir, "fake-npm.cjs");
    fs.writeFileSync(npmBin, fakeNpm(target, mode), { mode: 0o755 });
    return new PortlessRegistry({ stateDir: dir, bin: target, npmBin, pollMs: 60_000 });
  };

  posixOnly("caches detection until an install invalidates it", async () => {
    const registry = setup("ok");
    expect((await registry.readSnapshot()).portless.installed).toBe(false);
    fs.writeFileSync(target, "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 });
    expect((await registry.readSnapshot()).portless.installed).toBe(false);

    const result = await registry.installPortless();

    expect(result).toEqual({
      ok: true,
      value: { version: "1.2.3", output: "added 1 package in 2s" },
    });
    expect((await registry.readSnapshot()).portless).toEqual({ installed: true, version: "1.2.3" });
  });

  posixOnly("detects again once the cache expires", async () => {
    target = path.join(dir, "later-portless");
    const registry = new PortlessRegistry({ stateDir: dir, bin: target, detectTtlMs: 0 });
    expect((await registry.readSnapshot()).portless.installed).toBe(false);
    fs.writeFileSync(target, "#!/bin/sh\necho 3.0.0\n", { mode: 0o755 });
    expect((await registry.readSnapshot()).portless).toEqual({ installed: true, version: "3.0.0" });
  });

  posixOnly("returns install_failed with npm's output, without color codes", async () => {
    const registry = setup("fail");
    const result = await registry.installPortless();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("install_failed");
    expect(result.error.message).toContain("exited with code 243");
    expect(result.error.message).toContain("npm http fetch GET 200");
    expect(result.error.message).toContain("npm error code EACCES");
    expect(result.error.message).not.toContain("\u001b");
  });

  it("returns install_failed when npm cannot be found", async () => {
    const registry = new PortlessRegistry({
      stateDir: dir,
      bin,
      npmBin: path.join(dir, "no-such-npm"),
    });
    const result = await registry.installPortless();
    expect(result).toMatchObject({ ok: false, error: { code: "install_failed" } });
  });

  posixOnly("rejects a second install while one is running", async () => {
    const registry = setup("slow");
    const first = registry.installPortless();
    const second = await registry.installPortless();
    expect(second).toMatchObject({ ok: false, error: { code: "install_in_progress" } });
    expect((await first).ok).toBe(true);
    expect((await registry.installPortless()).ok).toBe(true);
  });

  posixOnly("notifies watchers after an install changes the installation", async () => {
    const registry = setup("ok");
    const onChange = vi.fn();
    stop = registry.watch(onChange);
    await registry.readSnapshot();

    await registry.installPortless();

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  });
});
