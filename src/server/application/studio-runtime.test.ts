import { DEFAULT_CONFIG, type StudioConfig } from "../../core/config/studio-config.ts";
import { ok, type Result } from "../../core/result.ts";
import type { Route } from "../../core/routes/route.ts";
import type { AppError } from "./app-error.ts";
import type { ConfigStore } from "./config-store.ts";
import type { HttpProbe, ListeningPort, PortScanner, ProbePort } from "./port-scanner.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";
import { StudioRuntime } from "./studio-runtime.ts";

const FAST: StudioConfig = { ...DEFAULT_CONFIG, scanIntervalMs: 10 };

function memoryStore(initial: StudioConfig = FAST) {
  const listeners = new Set<() => void>();
  const store: ConfigStore & { config: StudioConfig; writes: number; set(c: StudioConfig): void } =
    {
      path: "/fake/config.json",
      config: initial,
      writes: 0,
      read: async (): Promise<Result<StudioConfig, AppError>> => ok(store.config),
      write: async (config) => {
        store.config = config;
        store.writes += 1;
        return ok(undefined);
      },
      watch: (onChange) => {
        listeners.add(onChange);
        return () => listeners.delete(onChange);
      },
      set: (config) => {
        store.config = config;
        for (const listener of listeners) listener();
      },
    };
  return store;
}

function fakeScanner(ports: ListeningPort[]) {
  const scanner: PortScanner & { ports: ListeningPort[]; scans: number } = {
    ports,
    scans: 0,
    scan: async () => {
      scanner.scans += 1;
      return scanner.ports;
    },
    answersHttp: async () => true,
  };
  return scanner;
}

function fakeRegistry(proxyRunning = true) {
  const listeners = new Set<() => void>();
  const created: string[] = [];
  const proxyStarts: string[] = [];
  let routes: Route[] = [];
  const registry: RouteRegistry = {
    readSnapshot: async (): Promise<PortlessState> => ({
      proxy: { running: proxyRunning, port: 1355, https: false, tlds: ["localhost"] },
      portless: { installed: true, version: "1.0.0" },
      routes,
      readAt: 1,
    }),
    watch: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    createAlias: async (name, port) => {
      created.push(`${name} ${port}`);
      routes = [...routes, { ...aliasRoute(name, port) }];
      for (const listener of listeners) listener();
      return ok(undefined);
    },
    removeAlias: async () => ok(undefined),
    stopProxy: async () => ok(undefined),
    proxyPid: async () => null,
    installPortless: async () => ok({ version: null, output: "" }),
    startProxy: async (port, https) => {
      proxyStarts.push(`${port} ${https}`);
      return ok(undefined);
    },
  };
  return { registry, created, listeners, proxyStarts };
}

function aliasRoute(name: string, port: number): Route {
  return {
    hostname: `${name}.localhost`,
    name,
    port,
    kind: "alias",
    pid: null,
    registeredAt: null,
    url: "",
    tunnels: [],
  };
}

const projects = {
  read: (cwd: string) => ({
    packageName: null,
    repoName: null,
    folderName: cwd.split("/").pop() ?? null,
    worktreeName: null,
  }),
};

const node = (port: number, folder: string): ListeningPort => ({
  port,
  pid: port,
  processName: "node",
  cwd: `/code/${folder}`,
});

let runtime: StudioRuntime | undefined;

afterEach(() => {
  runtime?.stop();
  runtime = undefined;
});

function build(
  options: {
    store?: ReturnType<typeof memoryStore>;
    ports?: ListeningPort[];
    proxyRunning?: boolean;
    probe?: ProbePort;
  } = {},
) {
  const store = options.store ?? memoryStore();
  const scanner = fakeScanner(options.ports ?? [node(5173, "app"), node(4949, "studio")]);
  const fake = fakeRegistry(options.proxyRunning);
  const lines: string[] = [];
  runtime = new StudioRuntime({
    registry: fake.registry,
    scanner,
    configStore: store,
    projects,
    studioPort: 4949,
    log: (line) => lines.push(line),
    ...(options.probe ? { probe: options.probe, now: () => 1000 } : {}),
  });
  return { runtime, store, scanner, fake, lines };
}

describe("StudioRuntime proxy", () => {
  it("starts the proxy without sudo when it is not running", async () => {
    const { runtime, fake } = build({ proxyRunning: false });
    runtime.start();
    await vi.waitFor(() => expect(fake.proxyStarts).toEqual(["1355 false"]));
  });

  it("leaves a running proxy alone", async () => {
    const { runtime, fake } = build({ proxyRunning: true });
    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fake.proxyStarts).toEqual([]);
  });

  it("does not start the proxy when the config turns it off", async () => {
    const { runtime, fake } = build({
      proxyRunning: false,
      store: memoryStore({ ...FAST, startProxy: false }),
    });
    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fake.proxyStarts).toEqual([]);
  });
});

describe("StudioRuntime snapshot", () => {
  it("adds detected ports and auto mode to the portless state", async () => {
    const { runtime } = build();
    const snapshot = await runtime.readSnapshot();
    expect(snapshot.routes).toEqual([]);
    expect(snapshot.autoName).toBe(false);
    expect(snapshot.detected).toEqual([
      { port: 5173, pid: 5173, processName: "node", cwd: "/code/app", suggestedName: "app" },
    ]);
  });

  it("excludes the proxy port and ports with a route", async () => {
    const { runtime, fake } = build({ ports: [node(1355, "proxy"), node(5173, "app")] });
    await fake.registry.createAlias("app", 5173, false);
    expect((await runtime.readSnapshot()).detected).toEqual([]);
  });
});

describe("StudioRuntime scan loop", () => {
  it("scans while someone watches and notifies when the detected list changes", async () => {
    const { runtime, scanner } = build();
    let changes = 0;
    const stop = runtime.watch(() => changes++);
    await runtime.readSnapshot();
    // The first config read notifies once; count only what the scan finds.
    await new Promise((resolve) => setTimeout(resolve, 30));
    changes = 0;

    scanner.ports = [...scanner.ports, node(4321, "web")];
    await vi.waitFor(() => expect(changes).toBeGreaterThanOrEqual(1));
    expect((await runtime.readSnapshot()).detected.map((d) => d.port)).toEqual([4321, 5173]);

    stop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const scans = scanner.scans;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(scanner.scans).toBe(scans);
  });

  it("names new ports in auto mode with no one watching", async () => {
    const { runtime, fake, lines } = build({ store: memoryStore({ ...FAST, autoName: true }) });
    runtime.start();
    await vi.waitFor(() => expect(fake.created).toEqual(["app 5173"]));
    expect(lines).toEqual(["named 5173 -> app"]);
  });

  it("does not scan when nobody watches and auto mode is off", async () => {
    const { runtime, scanner } = build();
    runtime.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(scanner.scans).toBe(0);
  });

  it("applies config file edits live", async () => {
    const { runtime, store, fake } = build();
    runtime.start();
    let changes = 0;
    runtime.watch(() => changes++);

    store.set({ ...FAST, autoName: true });
    await vi.waitFor(() => expect(fake.created).toEqual(["app 5173"]));
    expect((await runtime.readSnapshot()).autoName).toBe(true);
    expect(changes).toBeGreaterThanOrEqual(1);
  });
});

describe("StudioRuntime config", () => {
  it("returns the config and where it lives", async () => {
    const { runtime } = build();
    expect(await runtime.readConfig()).toEqual({
      ok: true,
      value: { config: FAST, path: "/fake/config.json" },
    });
  });

  it("rejects an invalid config with invalid_config and writes nothing", async () => {
    const { runtime, store } = build();
    const result = await runtime.updateConfig({ scanIntervalMs: "fast" });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_config" } });
    expect(store.writes).toBe(0);
  });

  it("writes a valid config, applies it and notifies watchers", async () => {
    const { runtime, store } = build();
    let changes = 0;
    runtime.watch(() => changes++);
    const result = await runtime.updateConfig({ autoName: true, ignoredPorts: [5173] });
    expect(result.ok).toBe(true);
    expect(store.config).toMatchObject({ autoName: true, ignoredPorts: [5173] });
    expect(changes).toBeGreaterThanOrEqual(1);
    const snapshot = await runtime.readSnapshot();
    expect(snapshot.autoName).toBe(true);
    expect(snapshot.detected).toEqual([]);
  });

  it("ignores a detected port", async () => {
    const { runtime, store } = build({ store: memoryStore(DEFAULT_CONFIG) });
    expect(await runtime.ignorePort("5173")).toEqual({ ok: true, value: undefined });
    expect(store.config.ignoredPorts).toEqual([5173]);
    expect((await runtime.readSnapshot()).detected).toEqual([]);
    expect(await runtime.ignorePort("nope")).toMatchObject({
      ok: false,
      error: { code: "invalid_port" },
    });
  });
});

describe("StudioRuntime route details", () => {
  it("adds the pid listening on a route's port", async () => {
    const { runtime, fake } = build({ ports: [node(5173, "app")] });
    await fake.registry.createAlias("app", 5173, false);
    const [route] = (await runtime.readSnapshot()).routes;
    expect(route?.listenerPid).toBe(5173);
  });

  it("leaves the pid out when nothing listens on the route's port", async () => {
    const { runtime, fake } = build({ ports: [] });
    await fake.registry.createAlias("db", 5432, false);
    const [route] = (await runtime.readSnapshot()).routes;
    expect(route && "listenerPid" in route).toBe(false);
  });

  it("lists the pids that listen on detected or routed ports", async () => {
    const { runtime, fake } = build({ ports: [node(5173, "app"), node(3000, "web")] });
    await fake.registry.createAlias("web", 3000, false);
    expect(await runtime.stoppablePids()).toEqual(
      new Map([
        [5173, 5173],
        [3000, 3000],
      ]),
    );
  });

  it("probes route ports while someone watches and notifies when their health changes", async () => {
    const answers = new Map<number, HttpProbe | null>([
      [3000, { status: 200, latencyMs: 12, studio: false }],
    ]);
    const { runtime, fake } = build({
      ports: [node(3000, "web")],
      probe: async (port) => answers.get(port) ?? null,
    });
    await fake.registry.createAlias("web", 3000, false);
    let changes = 0;
    runtime.watch(() => {
      changes += 1;
    });

    await vi.waitFor(async () => {
      const [route] = (await runtime.readSnapshot()).routes;
      expect(route?.health).toEqual({ state: "up", status: 200, latencyMs: 12, checkedAt: 1000 });
    });

    const before = changes;
    answers.set(3000, { status: 503, latencyMs: 4, studio: false });
    await vi.waitFor(async () => {
      const [route] = (await runtime.readSnapshot()).routes;
      expect(route?.health?.state).toBe("error");
    });
    expect(changes).toBeGreaterThan(before);

    answers.set(3000, null);
    await vi.waitFor(async () => {
      const [route] = (await runtime.readSnapshot()).routes;
      expect(route?.health).toEqual({ state: "down", checkedAt: 1000 });
    });
  });

  it("does not probe while nobody watches", async () => {
    let probes = 0;
    const { runtime, fake } = build({
      probe: async () => {
        probes += 1;
        return null;
      },
    });
    await fake.registry.createAlias("web", 3000, false);
    await runtime.readSnapshot();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(probes).toBe(0);
  });
});
