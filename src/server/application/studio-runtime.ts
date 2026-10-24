import type { ConfigResponse, Snapshot } from "../../core/api/contract.ts";
import { DEFAULT_CONFIG, parseConfig, type StudioConfig } from "../../core/config/studio-config.ts";
import type { DetectedPort } from "../../core/ports/detected-port.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { healthFromProbe, type Route, type RouteHealth } from "../../core/routes/route.ts";
import { parsePort } from "../../core/routes/route-name.ts";
import { type AppError, appError } from "./app-error.ts";
import { AutoNamer } from "./auto-namer.ts";
import type { ConfigStore } from "./config-store.ts";
import { discoverPorts, type ProjectInfoSource } from "./port-discovery.ts";
import type { ListeningPort, PortScanner, ProbePort } from "./port-scanner.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";

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
};

type ScanResult = { ports: ListeningPort[]; at: number };

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
    this.#namer = new AutoNamer(this.#registry, this.#log);
  }

  /** Follows config file edits and runs auto mode. Call once the server is up. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#stopConfigWatch = this.#store.watch(() => void this.#reloadConfig());
    void this.#reloadConfig().then(() => {
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
    return {
      proxy: state.proxy,
      portless: state.portless,
      routes: this.#withDetails(state.routes),
      detected,
      autoName: config.autoName,
      readAt: state.readAt,
    };
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
    const excludedPorts = [this.#studioPort, state.proxy.port].filter((port) => port !== null);
    return discoverPorts(cached, this.#projects, { config, routes: state.routes, excludedPorts });
  }

  /** Reuses a scan younger than `maxAgeMs`, and shares one scan between concurrent callers. */
  #scanPorts(maxAgeMs: number): Promise<ScanResult> {
    if (this.#scan && Date.now() - this.#scan.at < maxAgeMs) return Promise.resolve(this.#scan);
    this.#scanning ??= this.#scanner.scan().then((ports) => {
      this.#scan = { ports, at: Date.now() };
      this.#scanning = null;
      return this.#scan;
    });
    return this.#scanning;
  }

  #reschedule(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const active = this.#watchers.size > 0 || (this.#started && this.#config.autoName);
    if (!active) return;
    this.#timer = setTimeout(() => void this.#tick(), this.#config.scanIntervalMs);
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const state = await this.#registry.readSnapshot();
      const config = await this.#currentConfig();
      const detected = await this.#detect(state, config, true);
      if (config.autoName) await this.#namer.name(detected);
      const healthChanged = await this.#probeRoutes(state.routes);
      if (healthChanged || JSON.stringify(detected) !== this.#lastDetected) this.#notify();
    } catch (error) {
      this.#log(`port scan failed: ${(error as Error).message}`);
    } finally {
      this.#ticking = false;
      this.#reschedule();
    }
  }

  /** Adds the listening pid and the last health to each route, when known. */
  #withDetails(routes: Route[]): Route[] {
    const pidByPort = this.#pidByPort();
    return routes.map((route) => {
      const pid = pidByPort.get(route.port);
      const health = this.#health.get(route.port);
      return {
        ...route,
        ...(pid === undefined ? {} : { listenerPid: pid }),
        ...(health === undefined ? {} : { health }),
      };
    });
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
    if (!probe || this.#watchers.size === 0) return false;
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
