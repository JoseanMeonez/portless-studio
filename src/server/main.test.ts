import * as fs from "node:fs";
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

  it("lets uninstall remove the files open-with and route projects write", () => {
    const files = createUninstallServices(path.join(dir, "config.json")).studioFiles;
    expect(files).toEqual(
      expect.arrayContaining(["config.json", "route-projects.json", "open-with.json"]),
    );
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
