import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  inspectRoutesFile,
  readProxyStatus,
  readRouteEntries,
  readRoutes,
  resolveStateDir,
} from "./state-files.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (file: string, content: string) => fs.writeFileSync(path.join(dir, file), content);
const proxy = { running: true, port: 1355, https: false, tlds: ["localhost"] };

describe("readRoutes", () => {
  it("returns no routes when routes.json is missing", () => {
    expect(readRoutes(dir, proxy)).toEqual([]);
  });

  it("returns no routes when routes.json is not a JSON array", () => {
    write("routes.json", "{not json");
    expect(readRoutes(dir, proxy)).toEqual([]);
    write("routes.json", '{"hostname":"web.localhost"}');
    expect(readRoutes(dir, proxy)).toEqual([]);
  });

  it("maps a live app and an alias", () => {
    write(
      "routes.json",
      JSON.stringify([
        { hostname: "web.localhost", port: 3000, pid: process.pid, registeredAt: 1700 },
        { hostname: "db.localhost", port: 5432, pid: 0 },
      ]),
    );
    expect(readRoutes(dir, proxy)).toEqual([
      {
        hostname: "db.localhost",
        name: "db",
        port: 5432,
        kind: "alias",
        pid: null,
        registeredAt: null,
        url: "http://db.localhost:1355",
        tunnels: [],
      },
      {
        hostname: "web.localhost",
        name: "web",
        port: 3000,
        kind: "app",
        pid: process.pid,
        registeredAt: 1700,
        url: "http://web.localhost:1355",
        tunnels: [],
      },
    ]);
  });

  it("drops invalid entries and keeps the valid ones", () => {
    write(
      "routes.json",
      JSON.stringify([
        null,
        "web",
        { hostname: "", port: 3000, pid: 0 },
        { hostname: "a.localhost", port: "3000", pid: 0 },
        { hostname: "b.localhost", port: 70000, pid: 0 },
        { hostname: "c.localhost", port: 3000 },
        { hostname: "d.localhost", port: 3000, pid: -1 },
        { hostname: "ok.localhost", port: 3000, pid: 0 },
      ]),
    );
    expect(readRoutes(dir, proxy).map((r) => r.name)).toEqual(["ok"]);
  });

  it("drops apps whose process is gone", () => {
    write(
      "routes.json",
      JSON.stringify([{ hostname: "gone.localhost", port: 3000, pid: 2 ** 22 + 7 }]),
    );
    expect(readRoutes(dir, proxy)).toEqual([]);
  });

  it("lists tunnel URLs", () => {
    write(
      "routes.json",
      JSON.stringify([
        {
          hostname: "web.localhost",
          port: 3000,
          pid: 0,
          tailscaleUrl: "https://box.tail1.ts.net",
          ngrokUrl: "https://x.ngrok.app",
          cloudflareUrl: "https://y.trycloudflare.com",
        },
      ]),
    );
    expect(readRoutes(dir, proxy)[0]?.tunnels).toEqual([
      { provider: "tailscale", url: "https://box.tail1.ts.net" },
      { provider: "ngrok", url: "https://x.ngrok.app" },
      { provider: "cloudflare", url: "https://y.trycloudflare.com" },
    ]);
  });

  it("names routes with the proxy TLDs", () => {
    write("routes.json", JSON.stringify([{ hostname: "api.test", port: 3000, pid: 0 }]));
    const route = readRoutes(dir, { ...proxy, https: true, port: 443, tlds: ["test"] })[0];
    expect(route).toMatchObject({ name: "api", url: "https://api.test" });
  });
});

describe("readRouteEntries", () => {
  it("tells a file portless is still writing from a missing one and an unknown format", () => {
    expect(readRouteEntries(dir)).toEqual({ kind: "missing" });
    write("routes.json", "");
    expect(readRouteEntries(dir)).toEqual({ kind: "torn" });
    write("routes.json", '[{"hostname":"web.local');
    expect(readRouteEntries(dir)).toEqual({ kind: "torn" });
    write("routes.json", '{"version":2,"routes":[]}');
    expect(readRouteEntries(dir)).toEqual({ kind: "unexpected" });
    write("routes.json", '[{"hostname":"web.localhost","port":3000,"pid":0}]');
    expect(readRouteEntries(dir)).toEqual({
      kind: "ok",
      entries: [{ hostname: "web.localhost", port: 3000, pid: 0 }],
    });
  });
});

describe("inspectRoutesFile", () => {
  it("counts entries Studio cannot read, but not apps whose process ended", () => {
    write(
      "routes.json",
      JSON.stringify([
        { hostname: "web.localhost", port: 3000, pid: 0 },
        { hostname: "gone.localhost", port: 3001, pid: 999_999_99 },
        { host: "new-format.localhost", target: { port: 3002 } },
        "web.localhost:3003",
      ]),
    );
    expect(inspectRoutesFile(dir)).toEqual({ state: "ok", entries: 4, unreadable: 2 });
  });

  it("reports a file in a format Studio does not know", () => {
    write("routes.json", '{"version":2,"routes":[]}');
    expect(inspectRoutesFile(dir)).toEqual({ state: "unexpected", entries: 0, unreadable: 0 });
  });
});

describe("readProxyStatus", () => {
  it("reports a proxy that never ran", () => {
    expect(readProxyStatus(dir)).toEqual({
      running: false,
      port: null,
      https: false,
      tlds: ["localhost"],
    });
  });

  it("reads port, TLS marker and TLD list of a running proxy", () => {
    write("proxy.port", "1355\n");
    write("proxy.pid", String(process.pid));
    write("proxy.tls", "1");
    write("proxy.tlds", "test\nlocalhost\n");
    expect(readProxyStatus(dir)).toEqual({
      running: true,
      port: 1355,
      https: true,
      tlds: ["test", "localhost"],
    });
  });

  it("is not running when the pid file points to a dead process", () => {
    write("proxy.port", "1355");
    write("proxy.pid", String(2 ** 22 + 7));
    expect(readProxyStatus(dir)).toMatchObject({ running: false, port: 1355 });
  });

  it("reads a JSON TLD list and falls back to proxy.tld", () => {
    write("proxy.tlds", '["dev","localhost"]');
    expect(readProxyStatus(dir).tlds).toEqual(["dev", "localhost"]);
    fs.rmSync(path.join(dir, "proxy.tlds"));
    write("proxy.tld", "dev\n");
    expect(readProxyStatus(dir).tlds).toEqual(["dev"]);
  });
});

describe("resolveStateDir", () => {
  it("prefers PORTLESS_STATE_DIR and falls back to ~/.portless", () => {
    expect(resolveStateDir({ PORTLESS_STATE_DIR: "/x" })).toBe("/x");
    expect(resolveStateDir({})).toBe(path.join(os.homedir(), ".portless"));
  });
});
