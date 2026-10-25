import type { StudioEvent } from "../../core/api/contract.ts";
import { DEFAULT_CONFIG, type StudioConfig } from "../../core/config/studio-config.ts";
import { err, ok, type Result } from "../../core/result.ts";
import type { Route } from "../../core/routes/route.ts";
import { type AppError, appError } from "./app-error.ts";
import type { AutoNamedEntry, AutoNamedStore } from "./auto-named-store.ts";
import type { ConfigStore } from "./config-store.ts";
import type { ContainerSource } from "./container-source.ts";
import type { IconFetcher } from "./icon-resolver.ts";
import type { ProjectInfoSource } from "./port-discovery.ts";
import type { HttpProbe, ListeningPort, PortScanner, ProbePort } from "./port-scanner.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";
import { type ForwardingPort, ShortUrls } from "./short-urls.ts";
import { memoryRouteProjectStore, StudioRuntime } from "./studio-runtime.ts";
import type { SystemNotifier } from "./system-notifier.ts";

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
  const removed: string[] = [];
  const proxyStarts: string[] = [];
  let routes: Route[] = [];
  const changed = () => {
    for (const listener of listeners) listener();
  };
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
    createAlias: async (name, port, force): Promise<Result<void, AppError>> => {
      if (!force && routes.some((route) => route.name === name)) {
        return err(appError("name_taken", `${name} is already registered`));
      }
      created.push(`${name} ${port}`);
      routes = [...routes.filter((route) => route.name !== name), aliasRoute(name, port)];
      changed();
      return ok(undefined);
    },
    removeAlias: async (name) => {
      removed.push(name);
      routes = routes.filter((route) => route.name !== name);
      changed();
      return ok(undefined);
    },
    stopProxy: async () => ok(undefined),
    proxyPid: async () => null,
    installPortless: async () => ok({ version: null, output: "" }),
    startProxy: async (port, https) => {
      proxyStarts.push(`${port} ${https}`);
      return ok(undefined);
    },
  };
  return { registry, created, removed, listeners, proxyStarts };
}

function memoryAutoNamed(initial: AutoNamedEntry[] = []) {
  const store: AutoNamedStore & { entries: AutoNamedEntry[] } = {
    entries: initial,
    read: async () => store.entries,
    write: async (entries) => {
      store.entries = entries;
    },
  };
  return store;
}

function aliasRoute(name: string, port: number): Route {
  return {
    hostname: `${name}.localhost`,
    name,
    port,
    kind: "alias",
    pid: null,
    registeredAt: null,
    url: `http://${name}.localhost:1355`,
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
    projects?: ProjectInfoSource;
    now?: () => number;
    proxyPids?: (pids: number[]) => Promise<ReadonlySet<number>>;
    autoNamed?: ReturnType<typeof memoryAutoNamed>;
    notifier?: SystemNotifier;
    icons?: IconFetcher;
    routeProjects?: ReturnType<typeof memoryRouteProjectStore>;
    containers?: ContainerSource;
    shortUrls?: ShortUrls;
  } = {},
) {
  const store = options.store ?? memoryStore();
  const scanner = fakeScanner(options.ports ?? [node(5173, "app"), node(4949, "studio")]);
  const fake = fakeRegistry(options.proxyRunning);
  const lines: string[] = [];
  const autoNamed = options.autoNamed ?? memoryAutoNamed();
  runtime = new StudioRuntime({
    registry: fake.registry,
    scanner,
    configStore: store,
    projects: options.projects ?? projects,
    studioPort: 4949,
    log: (line) => lines.push(line),
    autoNamedStore: autoNamed,
    ...(options.probe ? { probe: options.probe, now: () => 1000 } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.proxyPids ? { proxyPids: options.proxyPids } : {}),
    ...(options.containers ? { containers: options.containers } : {}),
    ...(options.notifier ? { notifier: options.notifier } : {}),
    ...(options.icons ? { icons: options.icons } : {}),
    ...(options.routeProjects ? { routeProjectStore: options.routeProjects } : {}),
    ...(options.shortUrls ? { shortUrls: options.shortUrls } : {}),
  });
  return { runtime, store, scanner, fake, lines, autoNamed };
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

  it("adds the published ports of running Docker containers", async () => {
    const containers: ContainerSource = {
      read: async () => ({
        state: "ok",
        containers: [
          {
            name: "web",
            image: "nginx",
            composeProject: null,
            composeService: null,
            ports: [8080],
          },
        ],
      }),
      stop: async () => ok(undefined),
    };
    const { runtime } = build({ containers });
    expect(
      (await runtime.readSnapshot()).detected.map((item) => item.container?.name ?? null),
    ).toEqual([null, "web"]);
  });

  it("shows ordinary ports when Docker cannot be read", async () => {
    const containers: ContainerSource = {
      read: async () => {
        throw new Error("boom");
      },
      stop: async () => ok(undefined),
    };
    const { runtime } = build({ containers });
    expect((await runtime.readSnapshot()).detected.map((item) => item.port)).toEqual([5173]);
  });

  it("excludes the proxy port and ports with a route", async () => {
    const { runtime, fake } = build({ ports: [node(1355, "proxy"), node(5173, "app")] });
    await fake.registry.createAlias("app", 5173, false);
    expect((await runtime.readSnapshot()).detected).toEqual([]);
  });
});

describe("StudioRuntime Studio's own route", () => {
  it("hides the route on Studio's port by default", async () => {
    const { runtime, fake } = build();
    await fake.registry.createAlias("studio", 4949, false);
    await fake.registry.createAlias("app", 5173, false);
    expect((await runtime.readSnapshot()).routes.map((route) => route.name)).toEqual(["app"]);
  });

  it("shows it with showStudioRoute, or when a caller asks for it", async () => {
    const shown = build({ store: memoryStore({ ...FAST, showStudioRoute: true }) });
    await shown.fake.registry.createAlias("studio", 4949, false);
    expect((await shown.runtime.readSnapshot()).routes.map((route) => route.name)).toEqual([
      "studio",
    ]);
    shown.runtime.stop();

    const asked = build();
    await asked.fake.registry.createAlias("studio", 4949, false);
    const snapshot = await asked.runtime.readSnapshot({ includeStudio: true });
    expect(snapshot.routes.map((route) => route.name)).toEqual(["studio"]);
  });

  it("raises no event for its own route", async () => {
    const { runtime, fake } = build();
    await runtime.readSnapshot();
    await fake.registry.createAlias("studio", 4949, false);
    await runtime.readSnapshot();
    expect(runtime.recentEvents()).toEqual([]);
  });

  it("still links notifications through the hidden studio route", async () => {
    const { runtime, fake } = build();
    await fake.registry.createAlias("studio", 4949, false);
    expect(await runtime.pageUrl({ focus: "app" })).toBe("http://studio.localhost:1355/?focus=app");
  });
});

describe("StudioRuntime short URLs", () => {
  function forwarding() {
    const calls: string[] = [];
    const port: ForwardingPort = {
      listen: async (listenPort, target) => {
        calls.push(`listen ${listenPort} -> ${target}`);
        return ok({ port: listenPort, close: async () => void calls.push("close") });
      },
    };
    return { calls, port };
  }

  it("starts the forwarder with the config and stops it when the setting goes off", async () => {
    const { calls, port } = forwarding();
    const shortUrls = new ShortUrls({ forwarding: port, port: 8080, log: () => {} });
    const { runtime, store } = build({
      store: memoryStore({ ...FAST, shortUrls: true }),
      shortUrls,
    });
    runtime.start();
    await runtime.ready();
    expect(calls).toEqual(["listen 8080 -> 1355"]);
    store.set({ ...FAST, shortUrls: false });
    await vi.waitFor(() => expect(calls).toEqual(["listen 8080 -> 1355", "close"]));
  });

  it("never lists the forwarder's port as a dev server, and tells watchers when it listens", async () => {
    const { port } = forwarding();
    const shortUrls = new ShortUrls({ forwarding: port, port: 8080, log: () => {} });
    const { runtime } = build({
      store: memoryStore({ ...FAST, shortUrls: true }),
      ports: [node(8080, "studio"), node(5173, "app")],
      shortUrls,
    });
    let notified = 0;
    runtime.watch(() => {
      notified += 1;
    });
    runtime.start();
    await runtime.ready();
    expect(notified).toBeGreaterThan(0);
    expect((await runtime.readSnapshot()).detected.map((item) => item.port)).toEqual([5173]);
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

describe("StudioRuntime projects", () => {
  // `/code/acme/<worktree>` is a linked worktree of acme-monorepo; `/code/main` is its main
  // checkout; anything else is a loose folder.
  const repos = {
    read: (cwd: string) => {
      const folder = cwd.split("/").pop() ?? null;
      const inAcme = cwd.startsWith("/code/acme/") || cwd === "/code/main";
      return {
        packageName: null,
        repoName: inAcme ? "acme-monorepo" : null,
        folderName: folder,
        worktreeName: cwd.startsWith("/code/acme/") ? folder : null,
      };
    },
  };

  it("maps a route to the project of the process listening on its port", async () => {
    const { runtime, fake } = build({
      ports: [node(3000, "acme/falcon"), node(4000, "main")],
      projects: repos,
    });
    await fake.registry.createAlias("web", 3000, false);
    await fake.registry.createAlias("api", 4000, false);
    await fake.registry.createAlias("db", 5432, false);
    const routes = (await runtime.readSnapshot()).routes;
    expect(routes.map((route) => [route.name, route.project])).toEqual([
      [
        "web",
        { name: "acme-monorepo", worktree: "falcon", branch: null, path: "/code/acme/falcon" },
      ],
      ["api", { name: "acme-monorepo", worktree: null, branch: null, path: "/code/main" }],
      ["db", undefined],
    ]);
  });

  it("keeps the last project of a route whose server stopped", async () => {
    const { runtime, fake, scanner } = build({
      ports: [node(3000, "acme/falcon")],
      projects: repos,
    });
    await fake.registry.createAlias("web", 3000, false);
    expect((await runtime.readSnapshot()).routes[0]?.project?.path).toBe("/code/acme/falcon");

    scanner.ports = [];
    await sleep(20);
    expect((await runtime.readSnapshot()).routes[0]?.project).toEqual({
      name: "acme-monorepo",
      worktree: "falcon",
      branch: null,
      path: "/code/acme/falcon",
    });
  });

  it("remembers the last project across restarts through its store", async () => {
    const routeProjects = memoryRouteProjectStore();
    const first = build({ ports: [node(3000, "acme/falcon")], projects: repos, routeProjects });
    await first.fake.registry.createAlias("web", 3000, false);
    await first.runtime.readSnapshot();
    first.runtime.stop();

    const second = build({ ports: [], projects: repos, routeProjects });
    await second.fake.registry.createAlias("web", 3000, false);
    const [route] = (await second.runtime.readSnapshot()).routes;
    expect(route?.project?.worktree).toBe("falcon");
    expect(await second.runtime.openableFolders()).toEqual(new Set(["/code/acme/falcon"]));
  });

  it("forgets the projects of routes that are gone", async () => {
    const routeProjects = memoryRouteProjectStore();
    const { runtime, fake } = build({
      ports: [node(3000, "acme/falcon"), node(4000, "main")],
      projects: repos,
      routeProjects,
    });
    await fake.registry.createAlias("web", 3000, false);
    await fake.registry.createAlias("api", 4000, false);
    await runtime.readSnapshot();
    await fake.registry.removeAlias("web");
    await runtime.readSnapshot();
    expect(Object.keys(await routeProjects.read())).toEqual(["api"]);
  });

  it("maps a detected port to its project and leaves loose folders without one", async () => {
    const { runtime } = build({
      ports: [node(5173, "acme/research"), node(8000, "scratch")],
      projects: repos,
    });
    const detected = (await runtime.readSnapshot()).detected;
    expect(detected.map((item) => [item.port, item.project])).toEqual([
      [
        5173,
        { name: "acme-monorepo", worktree: "research", branch: null, path: "/code/acme/research" },
      ],
      [8000, undefined],
    ]);
  });

  it("lists the folders of routes and detected ports as the ones Studio may open", async () => {
    const { runtime, fake } = build({
      ports: [node(3000, "acme/falcon"), node(5173, "acme/research"), node(8000, "scratch")],
      projects: repos,
    });
    await fake.registry.createAlias("web", 3000, false);
    expect(await runtime.openableFolders()).toEqual(
      new Set(["/code/acme/falcon", "/code/acme/research", "/code/scratch"]),
    );
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MINUTE = 60_000;

describe("StudioRuntime proxy ports", () => {
  it("never offers or names a port a portless proxy listens on, even one not in proxy.port", async () => {
    const { runtime, fake } = build({
      store: memoryStore({ ...FAST, autoName: true }),
      ports: [node(1356, "portless-studio"), node(5173, "app")],
      proxyPids: async (pids) => new Set(pids.filter((pid) => pid === 1356)),
    });
    expect((await runtime.readSnapshot()).detected.map((item) => item.port)).toEqual([5173]);
    runtime.start();
    await vi.waitFor(() => expect(fake.created).toEqual(["app 5173"]));
    await sleep(40);
    expect(fake.created).toEqual(["app 5173"]);
  });
});

describe("StudioRuntime auto removal", () => {
  function autoMode(minutes = 10, autoNamed = memoryAutoNamed()) {
    const clock = { now: 0 };
    const built = build({
      store: memoryStore({ ...FAST, autoName: true, autoRemoveAfterMinutes: minutes }),
      ports: [node(5173, "app")],
      now: () => clock.now,
      autoNamed,
    });
    return { ...built, clock };
  }

  it("records the names auto mode gives", async () => {
    const { runtime, fake, autoNamed } = autoMode();
    runtime.start();
    await vi.waitFor(() => expect(fake.created).toEqual(["app 5173"]));
    await vi.waitFor(() =>
      expect(autoNamed.entries).toEqual([{ name: "app", port: 5173, createdAt: 0 }]),
    );
  });

  it("removes an auto name once its port has been closed for the grace period", async () => {
    const { runtime, fake, scanner, clock, lines, autoNamed } = autoMode();
    runtime.start();
    await vi.waitFor(() => expect(autoNamed.entries).toHaveLength(1));

    scanner.ports = [];
    clock.now = 1000;
    await sleep(40);
    clock.now = 1000 + 9 * MINUTE;
    await sleep(40);
    expect(fake.removed).toEqual([]);

    clock.now = 1000 + 10 * MINUTE;
    await vi.waitFor(() => expect(fake.removed).toEqual(["app"]));
    expect(lines).toContain("removed app: port 5173 was closed for 10 minutes");
    await vi.waitFor(() => expect(autoNamed.entries).toEqual([]));
  });

  it("forgets the closed time when the port opens again", async () => {
    const { runtime, fake, scanner, clock, autoNamed } = autoMode();
    runtime.start();
    await vi.waitFor(() => expect(autoNamed.entries).toHaveLength(1));
    const listening = scanner.ports;

    scanner.ports = [];
    await sleep(40);
    clock.now = 9 * MINUTE;
    scanner.ports = listening;
    await sleep(40);
    scanner.ports = [];
    clock.now = 12 * MINUTE;
    await sleep(40);
    expect(fake.removed).toEqual([]);
  });

  it("never removes names a person or an agent gave", async () => {
    const { runtime, fake, scanner, clock, autoNamed } = autoMode();
    await fake.registry.createAlias("mine", 6000, false);
    runtime.start();
    await vi.waitFor(() => expect(autoNamed.entries).toHaveLength(1));
    // Someone points the auto name somewhere else: it is theirs now.
    await fake.registry.createAlias("app", 7000, true);
    scanner.ports = [];
    await sleep(40);
    clock.now = 60 * MINUTE;
    await sleep(60);
    expect(fake.removed).toEqual([]);
    await vi.waitFor(() => expect(autoNamed.entries).toEqual([]));
  });

  it("keeps auto names forever when the grace period is 0", async () => {
    const { runtime, fake, scanner, clock, autoNamed } = autoMode(0);
    runtime.start();
    await vi.waitFor(() => expect(autoNamed.entries).toHaveLength(1));
    scanner.ports = [];
    await sleep(40);
    clock.now = 600 * MINUTE;
    await sleep(60);
    expect(fake.removed).toEqual([]);
    expect(autoNamed.entries).toHaveLength(1);
  });

  it("removes auto names recorded by an earlier run", async () => {
    const autoNamed = memoryAutoNamed([{ name: "old", port: 7000, createdAt: 5 }]);
    const { runtime, fake, clock } = autoMode(10, autoNamed);
    await fake.registry.createAlias("old", 7000, false);
    runtime.start();
    await sleep(40);
    clock.now = 11 * MINUTE;
    await vi.waitFor(() => expect(fake.removed).toEqual(["old"]));
  });

  it("moves its own name to the new port when the project comes back on another port", async () => {
    const { runtime, fake, scanner, autoNamed } = autoMode();
    runtime.start();
    await vi.waitFor(() => expect(autoNamed.entries).toHaveLength(1));
    scanner.ports = [node(5174, "app")];
    await vi.waitFor(() => expect(fake.created).toEqual(["app 5173", "app 5174"]));
    await vi.waitFor(() =>
      expect(autoNamed.entries).toEqual([{ name: "app", port: 5174, createdAt: 0 }]),
    );
  });

  it("does not take a name from a server that still listens", async () => {
    const { runtime, fake, scanner, autoNamed } = autoMode();
    runtime.start();
    await vi.waitFor(() => expect(autoNamed.entries).toHaveLength(1));
    scanner.ports = [node(5173, "app"), node(5174, "app")];
    await vi.waitFor(() => expect(fake.created).toEqual(["app 5173", "app-5174 5174"]));
  });
});

describe("StudioRuntime events", () => {
  it("emits detected, named, removed, down and up, and keeps the recent ones", async () => {
    const answers = new Map<number, HttpProbe | null>([
      [3000, { status: 200, latencyMs: 1, studio: false }],
    ]);
    const { runtime, fake, scanner } = build({
      ports: [node(3000, "web")],
      probe: async (port) => answers.get(port) ?? null,
    });
    const heard: StudioEvent[] = [];
    runtime.watchEvents((event) => heard.push(event));
    runtime.watch(() => {});
    await runtime.readSnapshot();

    scanner.ports = [node(3000, "web"), node(5173, "app")];
    await vi.waitFor(() => expect(heard.map((event) => event.kind)).toContain("detected"));

    await fake.registry.createAlias("web", 3000, false);
    await vi.waitFor(() => expect(heard.map((event) => event.kind)).toContain("named"));
    await vi.waitFor(async () => {
      const [route] = (await runtime.readSnapshot()).routes;
      expect(route?.health?.state).toBe("up");
    });

    answers.set(3000, null);
    await vi.waitFor(() => expect(heard.map((event) => event.kind)).toContain("down"));
    answers.set(3000, { status: 200, latencyMs: 1, studio: false });
    await vi.waitFor(() => expect(heard.map((event) => event.kind)).toContain("up"));

    await fake.registry.removeAlias("web");
    await vi.waitFor(() => expect(heard.map((event) => event.kind)).toContain("removed"));

    expect(heard.map((event) => event.kind)).toEqual([
      "detected",
      "named",
      "down",
      "up",
      "removed",
    ]);
    expect(heard.find((event) => event.kind === "detected")?.target).toEqual({ port: 5173 });
    expect(runtime.recentEvents()).toEqual(heard);
  });
});

describe("StudioRuntime system notifications", () => {
  function recordingNotifier() {
    const sent: Array<{ title: string; url: string }> = [];
    const notifier: SystemNotifier = {
      notify: (event, url) => {
        sent.push({ title: event.title, url });
      },
    };
    return { notifier, sent };
  }

  it("asks the OS to show names auto mode gives when no tab is open", async () => {
    const { notifier, sent } = recordingNotifier();
    const { runtime, scanner } = build({
      store: memoryStore({ ...FAST, autoName: true, systemNotifications: true }),
      ports: [],
      notifier,
    });
    runtime.start();
    await sleep(40);
    scanner.ports = [node(5173, "app")];
    await vi.waitFor(() =>
      expect(sent).toEqual([{ title: "Named app", url: "http://localhost:4949/?focus=app" }]),
    );
  });

  it("stays quiet while a tab is open or when the setting is off", async () => {
    const open = recordingNotifier();
    const watched = build({
      store: memoryStore({ ...FAST, autoName: true, systemNotifications: true }),
      ports: [],
      notifier: open.notifier,
    });
    watched.runtime.watch(() => {});
    watched.runtime.start();
    await watched.runtime.readSnapshot();
    watched.scanner.ports = [node(5173, "app")];
    await vi.waitFor(() => expect(watched.fake.created).toEqual(["app 5173"]));
    await sleep(40);
    expect(open.sent).toEqual([]);
    watched.runtime.stop();

    const off = recordingNotifier();
    const quiet = build({
      store: memoryStore({ ...FAST, autoName: true }),
      ports: [],
      notifier: off.notifier,
    });
    quiet.runtime.start();
    await sleep(40);
    quiet.scanner.ports = [node(5173, "app")];
    await vi.waitFor(() => expect(quiet.fake.created).toEqual(["app 5173"]));
    await sleep(40);
    expect(off.sent).toEqual([]);
  });
});

describe("StudioRuntime icons", () => {
  const PNG = "data:image/png;base64,AAAA";
  const SVG = "data:image/svg+xml;base64,BBBB";
  const repoProjects: ProjectInfoSource = {
    read: (cwd) => ({
      packageName: null,
      repoName: cwd.split("/").pop() ?? null,
      folderName: null,
      worktreeName: null,
      rootDir: cwd,
    }),
  };

  function buildWithIcons(store = memoryStore()) {
    let served: string | null = null;
    const icons: IconFetcher = {
      served: async () => served,
      remote: async () => null,
      inFolder: (rootDir) => (rootDir === "/code/app" ? SVG : null),
    };
    const built = build({ projects: repoProjects, icons, store });
    return { ...built, serve: (icon: string) => (served = icon) };
  }

  it("gives detected ports and routes the folder icon, then the served favicon", async () => {
    const { runtime, fake, serve } = buildWithIcons();
    serve(PNG);
    const first = await runtime.readSnapshot();
    expect(first.detected[0]?.icon).toBe(SVG);
    const changed = vi.fn();
    runtime.watch(changed);
    await vi.waitFor(async () => {
      expect((await runtime.readSnapshot()).detected[0]?.icon).toBe(PNG);
    });
    await fake.registry.createAlias("app", 5173, false);
    const snapshot = await runtime.readSnapshot();
    expect(snapshot.routes[0]?.icon).toBe(PNG);
    expect(snapshot.projectIcons).toEqual({ app: PNG });
  });

  it("prefers the icon set for the project in the config", async () => {
    const { runtime } = buildWithIcons(memoryStore({ ...FAST, projectIcons: { app: "🦊" } }));
    await runtime.updateConfig({ ...FAST, projectIcons: { app: "🦊" } });
    const snapshot = await runtime.readSnapshot();
    expect(snapshot.detected[0]?.icon).toBe("🦊");
    expect(snapshot.projectIcons).toEqual({ app: "🦊" });
  });
});
