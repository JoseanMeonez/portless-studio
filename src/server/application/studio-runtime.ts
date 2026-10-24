import type { ConfigResponse, Snapshot } from "../../core/api/contract.ts";
import { DEFAULT_CONFIG, parseConfig, type StudioConfig } from "../../core/config/studio-config.ts";
import type { DetectedPort } from "../../core/ports/detected-port.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { parsePort } from "../../core/routes/route-name.ts";
import { type AppError, appError } from "./app-error.ts";
import { AutoNamer } from "./auto-namer.ts";
import type { ConfigStore } from "./config-store.ts";
import { discoverPorts, type ProjectInfoSource } from "./port-discovery.ts";
import type { ListeningPort, PortScanner } from "./port-scanner.ts";
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
    this.#namer = new AutoNamer(this.#registry, this.#log);
  }

  /** Follows config file edits and runs auto mode. Call once the server is up. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#stopConfigWatch = this.#store.watch(() => void this.#reloadConfig());
    void this.#reloadConfig().then(() => this.#reschedule());
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
      routes: state.routes,
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

  /** Calls `onChange` when routes, detected ports or the config change. Returns an unsubscribe. */
  watch(onChange: () => void): () => void {
    this.#watchers.add(onChange);
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
      if (JSON.stringify(detected) !== this.#lastDetected) this.#notify();
    } catch (error) {
      this.#log(`port scan failed: ${(error as Error).message}`);
    } finally {
      this.#ticking = false;
      this.#reschedule();
    }
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
