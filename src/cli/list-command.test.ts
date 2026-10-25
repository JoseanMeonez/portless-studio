import type { Snapshot } from "../core/api/contract.ts";
import { err, ok } from "../core/result.ts";
import { runListCommand } from "./list-command.ts";

const SNAPSHOT: Snapshot = {
  proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
  portless: { installed: true, version: "0.15.11" },
  routes: [
    {
      hostname: "app.acme.localhost",
      name: "app.acme",
      port: 5173,
      kind: "alias",
      pid: null,
      registeredAt: 1,
      url: "http://app.acme.localhost:1355",
      tunnels: [],
      listenerPid: 4242,
      health: { state: "up", checkedAt: 1 },
      project: { name: "acme-monorepo", worktree: null },
    },
  ],
  detected: [
    { port: 3000, pid: 5151, processName: "node", cwd: "/code/shop", suggestedName: "shop" },
  ],
  autoName: false,
  readAt: 1,
};

const ROUTE_ITEM = {
  name: "app.acme",
  url: "http://app.acme.localhost:1355",
  port: 5173,
  kind: "alias",
  health: "up",
  project: "acme-monorepo",
  worktree: null,
  pid: 4242,
  startedAt: null,
};
const DETECTED_ITEM = {
  port: 3000,
  pid: 5151,
  process: "node",
  folder: "/code/shop",
  suggestedName: "shop",
  project: null,
  worktree: null,
  startedAt: null,
};

function run(json: boolean, studioUp: boolean) {
  const lines: string[] = [];
  let localReads = 0;
  const done = runListCommand({
    json,
    print: (line) => lines.push(line),
    readFromStudio: async () =>
      studioUp
        ? ok(SNAPSHOT)
        : err({ kind: "not_running" as const, message: "Portless Studio is not running." }),
    readLocally: async () => {
      localReads += 1;
      return { proxy: SNAPSHOT.proxy, routes: SNAPSHOT.routes, detected: SNAPSHOT.detected };
    },
  });
  return done.then((code) => ({ code, lines, localReads }));
}

describe("runListCommand", () => {
  it("prints routes and detected ports as JSON from the running Studio", async () => {
    const { code, lines, localReads } = await run(true, true);
    expect(code).toBe(0);
    expect(localReads).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      source: "studio",
      proxy: { running: true, port: 1355 },
      routes: [ROUTE_ITEM],
      detected: [DETECTED_ITEM],
    });
  });

  it("reads locally when Studio is not running", async () => {
    const { lines, localReads } = await run(true, false);
    expect(localReads).toBe(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ source: "local" });
  });

  it("prints a readable list without --json", async () => {
    const { lines } = await run(false, false);
    const text = lines.join("\n");
    expect(text).toContain("Routes (1), proxy running on port 1355");
    expect(text).toMatch(/app\.acme\s+http:\/\/app\.acme\.localhost:1355\s+5173\s+up/);
    expect(text).toContain("Ports without a name (1)");
    expect(text).toMatch(/3000\s+node\s+\/code\/shop\s+suggested: shop/);
    expect(text).toContain("Studio is not running");
  });

  it("says names open without a port while Studio forwards port 80", async () => {
    const lines: string[] = [];
    const proxy = { ...SNAPSHOT.proxy, publicPort: 80 };
    await runListCommand({
      json: false,
      print: (line) => lines.push(line),
      readFromStudio: async () => ok({ ...SNAPSHOT, proxy }),
      readLocally: async () => ({ proxy, routes: [], detected: [] }),
    });
    expect(lines.join("\n")).toContain(
      "Routes (1), proxy running on port 1355, names open on port 80",
    );
  });
});
