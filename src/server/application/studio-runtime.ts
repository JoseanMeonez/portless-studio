import type { ConfigResponse, Snapshot, StudioEvent } from "../../core/api/contract.ts";
import { DEFAULT_CONFIG, parseConfig, type StudioConfig } from "../../core/config/studio-config.ts";
import { type DetectedPort, projectOf } from "../../core/ports/detected-port.ts";
import { itemProjectAt } from "../../core/projects/item-project.ts";
import { err, ok, type Result } from "../../core/result.ts";
import {
  healthFromProbe,
  type ItemProject,
  type Route,
  type RouteHealth,
} from "../../core/routes/route.ts";
import { parsePort } from "../../core/routes/route-name.ts";
import { type AppError, appError } from "./app-error.ts";
import {
  type AutoNamedEntry,
  type AutoNamedStore,
  memoryAutoNamedStore,
} from "./auto-named-store.ts";
import { AutoNamer } from "./auto-namer.ts";
import type { ConfigStore } from "./config-store.ts";
import { type IconFetcher, IconResolver, type IconSubject } from "./icon-resolver.ts";
import { discoverPorts, type ProjectInfoSource } from "./port-discovery.ts";
import type { ListeningPort, PortScanner, ProbePort } from "./port-scanner.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";
import { EventLog, eventsBetween, type Observation } from "./studio-events.ts";
import { SYSTEM_NOTIFICATION_KINDS, type SystemNotifier } from "./system-notifier.ts";

/**
 * The last project seen for each route name, so a route whose server is down still says where it
 * ran. The default implementation is `route-projects.json` next to the config.
 */
export interface RouteProjectStore {
  read(): Promise<Record<string, ItemProject>>;
  write(projects: Record<string, ItemProject>): Promise<void>;
}

/** Keeps the projects in memory only; for tests and for `init`, which runs once. */
export function memoryRouteProjectStore(): RouteProjectStore {
  let projects: Record<string, ItemProject> = {};
  return {
    read: async () => projects,
    write: async (next) => {
      projects = next;
    },
  };
}

export type StudioRuntimeOptions = {
  registry: RouteRegistry;
  scanner: PortScanner;
  configStore: ConfigStore;
  projects: ProjectInfoSource;
  /** Studio's own port, never shown as detected. Known only after the server listens. */
  studioPort?: number | null;
  /** Where auto mode reports each name it gives; stdout by default. */
  log?: (line: string) => void;
  /** Checks whether a route's port answers; without it routes carry no health. */
  probe?: ProbePort;
  now?: () => number;
  /** Which of these pids run a portless proxy; their ports are never offered as dev servers. */
  proxyPids?: (pids: number[]) => Promise<ReadonlySet<number>>;
  /** Remembers the names auto mode gave across restarts; in memory when omitted. */
  autoNamedStore?: AutoNamedStore;
  /** Shows events as OS notifications while no tab is open, when the config asks for it. */
  notifier?: SystemNotifier;
  /** Reads favicons; without it only icons set in the config are shown. */
  icons?: IconFetcher;
  /** Remembers each route's last project across restarts; in memory when omitted. */
  routeProjectStore?: RouteProjectStore;
};

type ScanResult = {
  ports: ListeningPort[];
  /** Ports a portless proxy process listens on, whatever the state files say. */
  proxyPorts: number[];
  at: number;
};

const MINUTE_MS = 60_000;

/**
 * Everything Studio adds to portless: detected ports, auto mode and the config. Owns the scan
 * loop, which runs while someone watches the snapshot or auto mode is on, so auto mode works
 * with no browser open.
 */
export class StudioRuntime {
  readonly #registry: RouteRegistry;
  readonly #scanner: PortScanner;
  readonly #store: ConfigStore;
  readonly #projects: ProjectInfoSource;
  readonly #namer: AutoNamer;
  readonly #log: (line: string) => void;
  readonly #probe: ProbePort | null;
  readonly #now: () => number;
  readonly #proxyPids: ((pids: number[]) => Promise<ReadonlySet<number>>) | null;
  readonly #autoNamedStore: AutoNamedStore;
  readonly #notifier: SystemNotifier | null;
  readonly #events = new EventLog();
  readonly #icons: IconResolver;
  readonly #routeProjectStore: RouteProjectStore;
  /** Last project seen per route name; null until read from the store. */
  #routeProjects: Map<string, ItemProject> | null = null;
  /** What the store last got, so an unchanged map is not written again. */
  #savedRouteProjects: string | null = null;
  /** Names auto mode gave; null until read from the store. */
  #autoNamed: AutoNamedEntry[] | null = null;
  /** When each auto name's port was first seen closed, by name. */
  readonly #closedSince = new Map<string, number>();
  /** What the last events were computed from; null until the first look sets the baseline. */
  #observed: Observation | null = null;
  /** Last probe of each routed port; only refreshed while someone watches. */
  #health = new Map<number, RouteHealth>();
  #studioPort: number | null;
  /** Last config that parsed; a broken file keeps Studio running on it. */
  #config: StudioConfig = DEFAULT_CONFIG;
  #configError: string | null = null;
  readonly #watchers = new Set<() => void>();
  #started = false;
  #timer: NodeJS.Timeout | undefined;
  #ticking = false;
  #scan: ScanResult | null = null;
  #scanning: Promise<ScanResult> | null = null;
  /** Fingerprint of the detected list watchers last got, to notify only on a change. */
  #lastDetected: string | null = null;
  #stopConfigWatch: (() => void) | undefined;
  #stopRegistryWatch: (() => void) | undefined;

  constructor(options: StudioRuntimeOptions) {
    this.#registry = options.registry;
    this.#scanner = options.scanner;
    this.#store = options.configStore;
    this.#projects = options.projects;
    this.#studioPort = options.studioPort ?? null;
    this.#log = options.log ?? ((line) => console.log(line));
    this.#probe = options.probe ?? null;
    this.#now = options.now ?? Date.now;
    this.#proxyPids = options.proxyPids ?? null;
    this.#autoNamedStore = options.autoNamedStore ?? memoryAutoNamedStore();
    this.#notifier = options.notifier ?? null;
    this.#routeProjectStore = options.routeProjectStore ?? memoryRouteProjectStore();
    const noIcons: IconFetcher = {
      served: async () => null,
      remote: async () => null,
      inFolder: () => null,
    };
    this.#icons = new IconResolver(options.icons ?? noIcons, () => this.#notify());
    this.#namer = new AutoNamer(this.#registry, this.#log, {
      onNamed: (name, port) => this.#rememberAutoName(name, port),
      canTake: (name) => this.#isAbandonedAutoName(name),
    });
  }

  /** Follows config file edits and runs auto mode. Call once the server is up. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#stopConfigWatch = this.#store.watch(() => void this.#reloadConfig());
    void Promise.all([this.#reloadConfig(), this.#loadAutoNamed()]).then(() => {
      this.#reschedule();
      void this.ensureProxy();
    });
  }

  /**
   * Starts the portless proxy when the config asks for it and it is not running, so names work
   * without anyone running portless by hand. Called at start and after portless gets installed.
   */
  async ensureProxy(): Promise<void> {
    const config = this.#config;
    if (!config.startProxy) return;
    const state = await this.#registry.readSnapshot();
    if (!state.portless.installed || state.proxy.running) return;
    const started = await this.#registry.startProxy(config.proxyPort, config.proxyHttps);
    this.#log(
      started.ok
        ? `started the portless proxy on port ${config.proxyPort}`
        : `could not start the portless proxy: ${started.error.message}`,
    );
  }

  stop(): void {
    this.#started = false;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#stopConfigWatch?.();
    this.#stopConfigWatch = undefined;
    this.#stopRegistryWatch?.();
    this.#stopRegistryWatch = undefined;
    this.#watchers.clear();
  }

  setStudioPort(port: number): void {
    this.#studioPort = port;
  }

  async readSnapshot(): Promise<Snapshot> {
    const state = await this.#registry.readSnapshot();
    const config = await this.#currentConfig();
    const detected = await this.#detect(state, config, false);
    this.#lastDetected = JSON.stringify(detected);
    const routes = await this.#detailedRoutes(state.routes);
    const snapshot: Snapshot = {
      proxy: state.proxy,
      portless: state.portless,
      routes,
      detected,
      autoName: config.autoName,
      readAt: state.readAt,
    };
    this.#observe(snapshot, config);
    return this.#withIcons(snapshot, config);
  }

  /** The last notable changes of this run, oldest first, for a page that connects later. */
  recentEvents(): StudioEvent[] {
    return this.#events.recent();
  }

  /** Calls `onEvent` with each new notable change. Returns an unsubscribe. */
  watchEvents(onEvent: (event: StudioEvent) => void): () => void {
    return this.#events.subscribe(onEvent);
  }

  /** One fresh scan with the current config, filtered the same way as the snapshot. */
  async detectPorts(): Promise<DetectedPort[]> {
    const state = await this.#registry.readSnapshot();
    return this.#detect(state, await this.#currentConfig(), true);
  }

  /** The config in effect: the file as last read, or the defaults while it is broken. */
  settings(): Promise<StudioConfig> {
    return this.#currentConfig();
  }

  /**
   * pid -> port for every process listening on a detected or routed port, from a fresh scan.
   * These are the only processes the UI may stop.
   */
  async stoppablePids(): Promise<Map<number, number>> {
    const state = await this.#registry.readSnapshot();
    const detected = await this.#detect(state, await this.#currentConfig(), true);
    const pids = new Map<number, number>();
    for (const item of detected) if (item.pid !== null) pids.set(item.pid, item.port);
    const pidByPort = this.#pidByPort();
    for (const route of state.routes) {
      const pid = pidByPort.get(route.port);
      if (pid !== undefined) pids.set(pid, route.port);
    }
    return pids;
  }

  /**
   * Folders Studio may open in an editor or the file manager: the project folder of every route
   * (the last one seen while its server is down) and the folder of every detected port. The
   * open-with endpoint accepts no other path.
   */
  async openableFolders(): Promise<Set<string>> {
    const state = await this.#registry.readSnapshot();
    const detected = await this.#detect(state, await this.#currentConfig(), false);
    const routes = await this.#detailedRoutes(state.routes);
    const folders = new Set<string>();
    for (const item of [...routes, ...detected]) {
      if (item.project?.path) folders.add(item.project.path);
    }
    for (const item of detected) if (item.cwd) folders.add(item.cwd);
    return folders;
  }

  /** Calls `onChange` when routes, detected ports or the config change. Returns an unsubscribe. */
  watch(onChange: () => void): () => void {
    this.#watchers.add(onChange);
    if (this.#watchers.size === 1 && this.#probe) void this.#refreshHealth();
    this.#stopRegistryWatch ??= this.#registry.watch(() => this.#notify());
    if (!this.#timer) void this.#currentConfig().then(() => this.#reschedule());
    return () => {
      this.#watchers.delete(onChange);
      if (this.#watchers.size === 0) {
        this.#stopRegistryWatch?.();
        this.#stopRegistryWatch = undefined;
        this.#reschedule();
      }
    };
  }

  async readConfig(): Promise<Result<ConfigResponse, AppError>> {
    const config = await this.#store.read();
    if (!config.ok) return config;
    return ok({ config: config.value, path: this.#store.path });
  }

  /** Replaces the whole config; missing fields take their defaults. */
  async updateConfig(input: unknown): Promise<Result<ConfigResponse, AppError>> {
    const config = parseConfig(input);
    if (!config.ok) return err(appError("invalid_config", config.error));
    const written = await this.#store.write(config.value);
    if (!written.ok) return written;
    this.#apply(config.value);
    return ok({ config: config.value, path: this.#store.path });
  }

  /** Adds the port to `ignoredPorts`, so it stops showing as detected. */
  async ignorePort(input: number | string): Promise<Result<void, AppError>> {
    const port = parsePort(input);
    if (!port.ok)
      return err(appError("invalid_port", "The port must be a number from 1 to 65535."));
    // Start from the file, not from memory, so a hand edit made a moment ago is kept.
    const current = await this.#store.read();
    if (!current.ok) return current;
    const updated = await this.updateConfig({
      ...current.value,
      ignoredPorts: [...current.value.ignoredPorts, port.value],
    });
    return updated.ok ? ok(undefined) : updated;
  }

  async #detect(state: PortlessState, config: StudioConfig, fresh: boolean) {
    const scan = await this.#scanPorts(fresh ? 0 : config.scanIntervalMs);
    const cached: PortScanner = {
      scan: async () => scan.ports,
      answersHttp: (port) => this.#scanner.answersHttp(port),
    };
    const excludedPorts = [this.#studioPort, state.proxy.port, ...scan.proxyPorts].filter(
      (port) => port !== null,
    );
    const found = await discoverPorts(cached, this.#projects, {
      config,
      routes: state.routes,
      excludedPorts,
    });
    return found.map((item) => {
      if (item.cwd === null || !item.project) return item;
      const project = itemProjectAt(this.#projects.read(item.cwd), item.cwd);
      return project === null ? item : { ...item, project };
    });
  }

  /** Reuses a scan younger than `maxAgeMs`, and shares one scan between concurrent callers. */
  #scanPorts(maxAgeMs: number): Promise<ScanResult> {
    if (this.#scan && Date.now() - this.#scan.at < maxAgeMs) return Promise.resolve(this.#scan);
    this.#scanning ??= this.#scanner.scan().then(async (ports) => {
      const proxyPorts = await this.#proxyPortsAmong(ports).catch(() => []);
      this.#scan = { ports, proxyPorts, at: Date.now() };
      this.#scanning = null;
      return this.#scan;
    });
    return this.#scanning;
  }

  #reschedule(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const config = this.#config;
    // Auto names left to take back keep the loop going even after auto mode is turned off.
    const background =
      config.autoName || config.systemNotifications || (this.#autoNamed?.length ?? 0) > 0;
    const active = this.#watchers.size > 0 || (this.#started && background);
    if (!active) return;
    this.#timer = setTimeout(() => void this.#tick(), this.#config.scanIntervalMs);
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      let state = await this.#registry.readSnapshot();
      const config = await this.#currentConfig();
      let detected = await this.#detect(state, config, true);
      // Each step reads the routes again after the previous one changed them.
      if (config.autoName && (await this.#namer.name(detected)) > 0) {
        state = await this.#registry.readSnapshot();
      }
      if (await this.#removeAbandonedAutoNames(state, config)) {
        state = await this.#registry.readSnapshot();
      }
      detected = await this.#detect(state, config, false);
      const healthChanged = await this.#probeRoutes(state.routes);
      const routes = await this.#detailedRoutes(state.routes);
      this.#observe({ ...state, routes, detected }, config);
      if (healthChanged || JSON.stringify(detected) !== this.#lastDetected) this.#notify();
    } catch (error) {
      this.#log(`port scan failed: ${(error as Error).message}`);
    } finally {
      this.#ticking = false;
      this.#reschedule();
    }
  }

  /**
   * Adds the listening pid, its project and the last health to each route, when known. A route
   * whose port has no readable process keeps the last project seen for its name.
   */
  async #detailedRoutes(routes: Route[]): Promise<Route[]> {
    const remembered = await this.#loadRouteProjects();
    const listeners = new Map<number, ListeningPort>();
    for (const port of this.#scan?.ports ?? [])
      if (port.pid !== null) listeners.set(port.port, port);
    const detailed = routes.map((route) => {
      const listener = listeners.get(route.port);
      const health = this.#health.get(route.port);
      const cwd = listener?.cwd ?? null;
      const seen = cwd === null ? null : itemProjectAt(this.#projects.read(cwd), cwd);
      if (seen !== null) remembered.set(route.name, seen);
      const project = cwd === null ? (remembered.get(route.name) ?? null) : seen;
      return {
        ...route,
        ...(listener?.pid == null ? {} : { listenerPid: listener.pid }),
        ...(project === null ? {} : { project }),
        ...(health === undefined ? {} : { health }),
      };
    });
    await this.#saveRouteProjects(remembered, routes);
    return detailed;
  }

  async #loadRouteProjects(): Promise<Map<string, ItemProject>> {
    this.#routeProjects ??= new Map(
      Object.entries(await this.#routeProjectStore.read().catch(() => ({}))),
    );
    return this.#routeProjects;
  }

  /** Drops routes that are gone and writes the file only when something changed. */
  async #saveRouteProjects(projects: Map<string, ItemProject>, routes: Route[]): Promise<void> {
    const names = new Set(routes.map((route) => route.name));
    // An empty list is more likely a state read that failed than every route removed at once.
    if (routes.length > 0)
      for (const name of projects.keys()) if (!names.has(name)) projects.delete(name);
    const next = JSON.stringify([...projects]);
    if (next === this.#savedRouteProjects) return;
    this.#savedRouteProjects = next;
    await this.#routeProjectStore
      .write(Object.fromEntries(projects))
      .catch((error: Error) => this.#log(`could not save the route projects: ${error.message}`));
  }

  /** Adds each item's icon and one icon per project; see `IconResolver` for the order. */
  #withIcons(snapshot: Snapshot, config: StudioConfig): Snapshot {
    const listeners = new Map<number, ListeningPort>();
    for (const port of this.#scan?.ports ?? []) listeners.set(port.port, port);
    const subject = (port: number, pid: number | null, cwd: string | null): IconSubject => {
      const info = cwd === null ? null : this.#projects.read(cwd);
      const project = info === null ? null : projectOf(info);
      return { port, pid, project: project?.name ?? null, rootDir: info?.rootDir ?? null };
    };
    const withIcon = <T extends object>(item: T, at: IconSubject): T => {
      const icon = this.#icons.iconFor(at, config.projectIcons);
      return icon === null ? item : { ...item, icon };
    };
    const routes = snapshot.routes.map((route) => {
      const listener = listeners.get(route.port);
      return withIcon(route, subject(route.port, listener?.pid ?? null, listener?.cwd ?? null));
    });
    const detected = snapshot.detected.map((item) =>
      withIcon(item, subject(item.port, item.pid, item.cwd)),
    );

    const projectIcons: Record<string, string> = {};
    for (const item of [...routes, ...detected]) {
      const name = item.project?.name;
      if (!name || Object.hasOwn(projectIcons, name)) continue;
      const icon = this.#icons.configuredIcon(name, config.projectIcons) ?? item.icon;
      if (icon !== undefined) projectIcons[name] = icon;
    }
    return { ...snapshot, routes, detected, projectIcons };
  }

  #pidByPort(): Map<number, number> {
    const pids = new Map<number, number>();
    for (const port of this.#scan?.ports ?? [])
      if (port.pid !== null) pids.set(port.port, port.pid);
    return pids;
  }

  async #refreshHealth(): Promise<void> {
    const state = await this.#registry.readSnapshot();
    if (await this.#probeRoutes(state.routes)) this.#notify();
  }

  /** Probes every routed port while someone watches; true when a state or status changed. */
  async #probeRoutes(routes: Route[]): Promise<boolean> {
    const probe = this.#probe;
    // With OS notifications on, a route going down is worth noticing with no tab open too.
    if (!probe || (this.#watchers.size === 0 && !this.#config.systemNotifications)) return false;
    const ports = [...new Set(routes.map((route) => route.port))];
    const answers = await Promise.all(ports.map((port) => probe(port).catch(() => null)));
    const checkedAt = this.#now();
    const next = new Map(
      ports.map((port, index) => [port, healthFromProbe(answers[index] ?? null, checkedAt)]),
    );
    // Latency changes on every probe; only a new state or status is worth a push.
    const key = (health: Map<number, RouteHealth>) =>
      JSON.stringify([...health].map(([port, item]) => [port, item.state, item.status ?? null]));
    const changed = key(next) !== key(this.#health);
    this.#health = next;
    return changed;
  }

  async #proxyPortsAmong(ports: ListeningPort[]): Promise<number[]> {
    if (!this.#proxyPids) return [];
    const pids = [...new Set(ports.flatMap((port) => (port.pid === null ? [] : [port.pid])))];
    const proxies = await this.#proxyPids(pids);
    return ports
      .filter((port) => port.pid !== null && proxies.has(port.pid))
      .map((port) => port.port);
  }

  /** Turns what changed since the last look into events, and tells the OS when nobody watches. */
  #observe(snapshot: Pick<Snapshot, "routes" | "detected" | "proxy">, config: StudioConfig): void {
    const next: Observation = {
      routes: snapshot.routes,
      detected: snapshot.detected,
      proxy: snapshot.proxy,
    };
    const previous = this.#observed;
    this.#observed = next;
    if (!previous) return;
    const events = this.#events.add(eventsBetween(previous, next));
    const notifier = this.#notifier;
    if (!notifier || !config.systemNotifications || this.#watchers.size > 0) return;
    for (const event of events) {
      if (SYSTEM_NOTIFICATION_KINDS.has(event.kind)) {
        notifier.notify(event, this.#studioUrl(snapshot.routes, event, config));
      }
    }
  }

  /** Studio's page showing the event's item: through its own route when it has one. */
  #studioUrl(routes: readonly Route[], event: StudioEvent, config: StudioConfig): string {
    const port = this.#studioPort ?? config.port;
    const own = routes.find((route) => route.port === port);
    const url = new URL(own?.url ?? `http://localhost:${port}`);
    const { route, port: targetPort } = event.target;
    const focus = route ?? (targetPort === undefined ? null : `port:${targetPort}`);
    if (focus !== null) url.searchParams.set("focus", focus);
    return url.toString();
  }

  async #loadAutoNamed(): Promise<AutoNamedEntry[]> {
    this.#autoNamed ??= await this.#autoNamedStore.read().catch(() => []);
    return this.#autoNamed;
  }

  async #saveAutoNamed(entries: AutoNamedEntry[]): Promise<void> {
    this.#autoNamed = entries;
    await this.#autoNamedStore
      .write(entries)
      .catch((error: Error) => this.#log(`could not save the auto names: ${error.message}`));
  }

  async #rememberAutoName(name: string, port: number): Promise<void> {
    const entries = (await this.#loadAutoNamed()).filter((entry) => entry.name !== name);
    this.#closedSince.delete(name);
    await this.#saveAutoNamed([...entries, { name, port, createdAt: this.#now() }]);
  }

  /** Auto mode gave this name and nothing listens on its port in the last scan. */
  #isAbandonedAutoName(name: string): boolean {
    const entry = this.#autoNamed?.find((item) => item.name === name);
    if (!entry) return false;
    return !(this.#scan?.ports ?? []).some((port) => port.port === entry.port);
  }

  /**
   * Takes back auto names whose port has been closed for `autoRemoveAfterMinutes`. A name that
   * no longer points where auto mode left it belongs to someone else now and is forgotten, not
   * removed. Returns whether any name was removed.
   */
  async #removeAbandonedAutoNames(state: PortlessState, config: StudioConfig): Promise<boolean> {
    const entries = await this.#loadAutoNamed();
    if (entries.length === 0) return false;
    const listening = new Set((this.#scan?.ports ?? []).map((port) => port.port));
    const limitMs = config.autoRemoveAfterMinutes * MINUTE_MS;
    const now = this.#now();
    const keep: AutoNamedEntry[] = [];
    let removedAny = false;
    for (const entry of entries) {
      const route = state.routes.find((item) => item.name === entry.name);
      if (route?.kind !== "alias" || route.port !== entry.port) {
        this.#closedSince.delete(entry.name);
        continue;
      }
      if (listening.has(entry.port)) {
        this.#closedSince.delete(entry.name);
        keep.push(entry);
        continue;
      }
      const since = this.#closedSince.get(entry.name) ?? now;
      this.#closedSince.set(entry.name, since);
      if (limitMs > 0 && now - since >= limitMs) {
        const removed = await this.#registry.removeAlias(entry.name);
        if (removed.ok) {
          const minutes = config.autoRemoveAfterMinutes;
          this.#log(`removed ${entry.name}: port ${entry.port} was closed for ${minutes} minutes`);
          this.#closedSince.delete(entry.name);
          removedAny = true;
          continue;
        }
        this.#log(`could not remove ${entry.name}: ${removed.error.message}`);
      }
      keep.push(entry);
    }
    if (keep.length !== entries.length) await this.#saveAutoNamed(keep);
    return removedAny;
  }

  async #currentConfig(): Promise<StudioConfig> {
    // While started, the file watch keeps #config current; otherwise read it each time.
    if (!this.#started) await this.#reloadConfig();
    return this.#config;
  }

  async #reloadConfig(): Promise<void> {
    const config = await this.#store.read();
    if (!config.ok) {
      if (this.#configError !== config.error.message) this.#log(config.error.message);
      this.#configError = config.error.message;
      return;
    }
    this.#configError = null;
    this.#apply(config.value);
  }

  #apply(config: StudioConfig): void {
    if (JSON.stringify(config) === JSON.stringify(this.#config)) return;
    this.#config = config;
    this.#reschedule();
    this.#notify();
  }

  #notify(): void {
    for (const watcher of this.#watchers) watcher();
  }
}
