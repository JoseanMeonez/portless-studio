import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PortlessRegistry } from "./portless-registry.ts";

// Stands in for `portless alias`: same arguments, messages and exit codes, no proxy needed.
const FAKE_PORTLESS = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const file = path.join(process.env.PORTLESS_STATE_DIR, "routes.json");
const routes = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
const args = process.argv.slice(2);
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
});
