import * as fs from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ConfigResponse, OpenWithAppsResponse, Snapshot } from "../core/api/contract.ts";
import { API_PATHS, TOKEN_HEADER } from "../core/api/contract.ts";
import type { PortScanner } from "./application/port-scanner.ts";
import {
  createStudioServices,
  createUninstallServices,
  defaultConfigPath,
  type RunningServer,
  type StudioServices,
  startServer,
} from "./main.ts";

let dir: string;
let running: RunningServer | undefined;
const previousConfigEnv = process.env.PORTLESS_STUDIO_CONFIG;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
  // Keeps every test off the real config file in the home folder.
  process.env.PORTLESS_STUDIO_CONFIG = path.join(dir, "config.json");
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  if (previousConfigEnv === undefined) delete process.env.PORTLESS_STUDIO_CONFIG;
  else process.env.PORTLESS_STUDIO_CONFIG = previousConfigEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

const scanner: PortScanner = {
  scan: async () => [{ port: 5173, pid: 7, processName: "node", cwd: null }],
  answersHttp: async () => true,
};

describe("createStudioServices", () => {
  it("uses the given config file and finds the default one through the environment", async () => {
    const configPath = path.join(dir, "custom", "studio.json");
    const services = createStudioServices({ stateDir: dir, configPath });
    expect(services.configStore.path).toBe(configPath);
    expect(defaultConfigPath()).toBe(path.join(dir, "config.json"));
    expect(createStudioServices({ stateDir: dir }).configStore.path).toBe(
      path.join(dir, "config.json"),
    );
  });

  it("detects ports with the same filters as the UI", async () => {
    const services: StudioServices = { ...createStudioServices({ stateDir: dir }), scanner };
    running = await startServer({ port: 0, services });
    const response = await fetch(`${running.url}${API_PATHS.snapshot}`);
    const snapshot = (await response.json()) as Snapshot;
    expect(snapshot.detected).toEqual([
      { port: 5173, pid: 7, processName: "node", cwd: null, suggestedName: null },
    ]);
    expect(snapshot.autoName).toBe(false);
  });

  it("serves the config of the given services", async () => {
    const configPath = path.join(dir, "studio.json");
    fs.writeFileSync(configPath, JSON.stringify({ autoName: false, ignoredPorts: [9] }));
    const services = { ...createStudioServices({ stateDir: dir, configPath }), scanner };
    running = await startServer({ port: 0, services });
    const response = await fetch(`${running.url}${API_PATHS.config}`);
    const body = (await response.json()) as ConfigResponse;
    expect(body.path).toBe(configPath);
    expect(body.config.ignoredPorts).toEqual([9]);
  });
});

describe("terminals", () => {
  it("lists the terminals running when Studio last stopped and keeps them on the next stop", async () => {
    const configPath = path.join(dir, "studio.json");
    fs.writeFileSync(configPath, JSON.stringify({ restoreTerminals: "ask" }));
    const saved = {
      command: "pnpm dev",
      cwd: dir,
      title: "web",
      startedAt: 1,
      startedBy: "program",
      project: null,
      worktree: null,
      branch: null,
    };
    const file = path.join(dir, "terminals.json");
    fs.writeFileSync(file, JSON.stringify({ running: [saved], recentCommands: {} }));
    const services = { ...createStudioServices({ stateDir: dir, configPath }), scanner };
    running = await startServer({ port: 0, services });
    const headers = { [TOKEN_HEADER]: running.token };
    const list = async () => {
      const response = await fetch(`${running?.url}${API_PATHS.terminals}`, { headers });
      return ((await response.json()) as { terminals: { stoppedByRestart?: boolean }[] }).terminals;
    };
    await vi.waitFor(async () => expect(await list()).toHaveLength(1));
    expect((await list())[0]?.stoppedByRestart).toBe(true);
    await running.close();
    running = undefined;
    expect(JSON.parse(fs.readFileSync(file, "utf8")).running).toEqual([saved]);
  });
});

describe("open with", () => {
  it("keeps custom apps in open-with.json next to the config and lists them", async () => {
    const configPath = path.join(dir, "studio.json");
    const services = { ...createStudioServices({ stateDir: dir, configPath }), scanner };
    running = await startServer({ port: 0, services });
    const saved = await fetch(`${running.url}${API_PATHS.customApps}`, {
      method: "PUT",
      headers: { [TOKEN_HEADER]: running.token, "content-type": "application/json" },
      body: JSON.stringify({ apps: [{ name: "Helix", command: "foot hx {path}" }] }),
    });
    expect(saved.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "open-with.json"), "utf8"))).toEqual({
      customApps: [{ name: "Helix", command: "foot hx {path}" }],
    });
    const response = await fetch(`${running.url}${API_PATHS.openWithApps}`);
    const apps = (await response.json()) as OpenWithAppsResponse;
    expect(apps.apps.at(-1)).toEqual({ id: "custom-1", name: "Helix", kind: "custom" });
  });

  it("lets uninstall remove the files open-with, route projects and update checks write", () => {
    const files = createUninstallServices(path.join(dir, "config.json")).studioFiles;
    expect(files).toEqual(
      expect.arrayContaining([
        "config.json",
        "route-projects.json",
        "open-with.json",
        "update-check.json",
        "terminals.json",
      ]),
    );
  });

  it("never asks npm for updates while tests run", async () => {
    const services = createStudioServices({
      configPath: path.join(dir, "config.json"),
      stateDir: path.join(dir, "portless"),
      version: "0.0.1",
    });
    expect(await services.updates?.status()).toMatchObject({ latest: null, available: false });
    expect(fs.existsSync(path.join(dir, "update-check.json"))).toBe(false);
  });
});

describe("startServer", () => {
  // The real scanner starts PowerShell on Windows, which alone can outlast a test's timeout.
  function servicesWithFakeScanner(portlessBin: string): StudioServices {
    return { ...createStudioServices({ stateDir: dir, portlessBin }), scanner };
  }

  it("serves the snapshot of the given state directory on loopback", async () => {
    fs.writeFileSync(
      path.join(dir, "routes.json"),
      JSON.stringify([{ hostname: "db.localhost", port: 5432, pid: 0 }]),
    );
    running = await startServer({ port: 0, services: servicesWithFakeScanner("portless") });
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(running.token.length).toBeGreaterThanOrEqual(32);

    const response = await fetch(`${running.url}${API_PATHS.snapshot}`);
    const snapshot = (await response.json()) as { routes: { name: string }[] };
    expect(snapshot.routes.map((r) => r.name)).toEqual(["db"]);
  });

  it("forwards the short-URL port to the proxy and drops the port from route URLs", async () => {
    const proxy = http.createServer((req, res) => {
      res.setHeader("x-portless", "1");
      res.end(`host=${req.headers.host}`);
    });
    const proxyPort = await listenOn(proxy, 0);
    const shortPort = await freePort();
    fs.writeFileSync(path.join(dir, "proxy.port"), String(proxyPort));
    fs.writeFileSync(
      path.join(dir, "routes.json"),
      JSON.stringify([{ hostname: "db.localhost", port: 5432, pid: 0 }]),
    );
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ shortUrls: true, proxyPort, startProxy: false }),
    );
    const services: StudioServices = {
      ...createStudioServices({ stateDir: dir, portlessBin: "portless", shortUrlPort: shortPort }),
      scanner,
    };
    try {
      running = await startServer({ port: 0, services });
      const snapshot = (await (await fetch(`${running.url}${API_PATHS.snapshot}`)).json()) as {
        proxy: { publicPort?: number };
        routes: { url: string }[];
      };
      expect(snapshot.proxy.publicPort).toBe(shortPort);
      expect(snapshot.routes.map((route) => route.url)).toEqual([
        `http://db.localhost:${shortPort}`,
      ]);
      const reply = await getWithHost(shortPort, "db.localhost");
      expect(reply).toBe("host=db.localhost");
    } finally {
      await running?.close();
      running = undefined;
      proxy.closeAllConnections();
      await new Promise((resolve) => proxy.close(resolve));
    }
    expect(services.shortUrls?.publicPort()).toBe(null);
  });

  it("creates a different token on every run", async () => {
    const first = await startServer({ port: 0, stateDir: dir });
    const second = await startServer({ port: 0, stateDir: dir });
    expect(first.token).not.toBe(second.token);
    await first.close();
    await second.close();
  });

  it("reports portless as missing when its binary does not exist", async () => {
    running = await startServer({
      port: 0,
      services: servicesWithFakeScanner(path.join(dir, "no-such-portless")),
    });
    const response = await fetch(`${running.url}${API_PATHS.snapshot}`);
    const snapshot = (await response.json()) as { portless: unknown };
    expect(snapshot.portless).toEqual({ installed: false, version: null });
  });
});

function listenOn(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve) =>
    server.listen({ port, host: "127.0.0.1" }, () =>
      resolve((server.address() as AddressInfo).port),
    ),
  );
}

async function freePort(): Promise<number> {
  const probe = http.createServer();
  const port = await listenOn(probe, 0);
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function getWithHost(port: number, host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/", headers: { host }, agent: false },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
