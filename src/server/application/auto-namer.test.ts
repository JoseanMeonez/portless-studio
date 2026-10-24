import type { DetectedPort } from "../../core/ports/detected-port.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { type AppError, appError } from "./app-error.ts";
import { AutoNamer } from "./auto-namer.ts";
import type { RouteRegistry } from "./route-registry.ts";

function registryTaking(taken: string[], failing: string[] = []) {
  const calls: string[] = [];
  const registry: RouteRegistry = {
    readSnapshot: async () => ({
      proxy: { running: false, port: null, https: false, tlds: ["localhost"] },
      portless: { installed: true, version: "1" },
      routes: [],
      readAt: 1,
    }),
    watch: () => () => {},
    createAlias: async (name, port, force): Promise<Result<void, AppError>> => {
      calls.push(`${name} ${port} ${force}`);
      if (taken.includes(name)) return err(appError("name_taken", `${name} is taken`));
      if (failing.includes(name)) return err(appError("internal", "boom"));
      return ok(undefined);
    },
    removeAlias: async () => ok(undefined),
    installPortless: async () => ok({ version: null, output: "" }),
    startProxy: async () => ok(undefined),
    stopProxy: async () => ok(undefined),
    proxyPid: async () => null,
  };
  return { registry, calls };
}

const detected = (port: number, suggestedName: string | null, pid = 1): DetectedPort => ({
  port,
  pid,
  processName: "node",
  cwd: "/x",
  suggestedName,
});

describe("AutoNamer", () => {
  it("names each port once and logs it", async () => {
    const { registry, calls } = registryTaking([]);
    const lines: string[] = [];
    const namer = new AutoNamer(registry, (line) => lines.push(line));

    expect(await namer.name([detected(5173, "app.acme"), detected(9000, null)])).toBe(1);
    expect(await namer.name([detected(5173, "app.acme")])).toBe(0);
    expect(calls).toEqual(["app.acme 5173 false"]);
    expect(lines).toEqual(["named 5173 -> app.acme"]);
  });

  it("retries once with the port appended when the name is taken", async () => {
    const { registry, calls } = registryTaking(["web.acme"]);
    const lines: string[] = [];
    const namer = new AutoNamer(registry, (line) => lines.push(line));

    expect(await namer.name([detected(4321, "web.acme")])).toBe(1);
    expect(calls).toEqual(["web.acme 4321 false", "web.acme-4321 4321 false"]);
    expect(lines).toEqual(["named 4321 -> web.acme-4321"]);
  });

  it("does not retry a port and process that already failed", async () => {
    const { registry, calls } = registryTaking(["db", "db-4983"]);
    const lines: string[] = [];
    const namer = new AutoNamer(registry, (line) => lines.push(line));

    expect(await namer.name([detected(4983, "db")])).toBe(0);
    expect(await namer.name([detected(4983, "db")])).toBe(0);
    expect(calls).toEqual(["db 4983 false", "db-4983 4983 false"]);
    expect(lines).toEqual(["could not name 4983: db-4983 is taken"]);

    // A new process on the same port is a new server and gets its own try.
    await namer.name([detected(4983, "db", 2)]);
    expect(calls).toHaveLength(4);
  });

  it("does not retry other failures with another name", async () => {
    const { registry, calls } = registryTaking([], ["api"]);
    const namer = new AutoNamer(registry, () => {});
    expect(await namer.name([detected(3000, "api")])).toBe(0);
    expect(calls).toEqual(["api 3000 false"]);
  });
});
