import type {
  ApiError,
  ConfigResponse,
  CreateAliasRequest,
  InstallPortlessResponse,
  RenameAliasRequest,
  Snapshot,
} from "../../../../core/api/contract.ts";
import {
  DEFAULT_CONFIG,
  parseConfig,
  type StudioConfig,
} from "../../../../core/config/studio-config.ts";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import { err, ok, type Result } from "../../../../core/result.ts";
import { type Route, routeUrl } from "../../../../core/routes/route.ts";
import { parsePort, parseRouteName } from "../../../../core/routes/route-name.ts";
import type { ConnectionListener, RoutesGateway, SnapshotListener } from "./routes-gateway.ts";

export type InMemoryRoutesGatewayOptions = {
  /** How long the fake `npm install -g portless` takes. */
  installDelayMs?: number;
  installOutcome?: "success" | "failure";
  /** How long auto mode waits before naming a newly detected port, like the server's next scan. */
  autoNameDelayMs?: number;
  /** Where the fake config file lives, shown in the settings panel. */
  configPath?: string;
};

export const DEMO_CONFIG_PATH = "~/.portless-studio/config.json";

/** Version the fake install reports. */
export const DEMO_PORTLESS_VERSION = "0.4.2";

/**
 * `RoutesGateway` that keeps routes in memory. Tests use it to drive the UI, and `?demo` uses it
 * to show the app without a server. It follows the same rules as the real API.
 */
export class InMemoryRoutesGateway implements RoutesGateway {
  #snapshot: Snapshot;
  readonly #listeners = new Set<SnapshotListener>();
  readonly #now: () => number;
  readonly #options: InMemoryRoutesGatewayOptions;
  #installing = false;
  #config: StudioConfig;
  // Every port listening on the fake machine; `snapshot.detected` is the part not named or ignored.
  #listening: DetectedPort[];
  #autoNameTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    initial: Snapshot,
    now: () => number = Date.now,
    options: InMemoryRoutesGatewayOptions = {},
  ) {
    this.#snapshot = initial;
    this.#now = now;
    this.#options = options;
    this.#config = { ...DEFAULT_CONFIG, autoName: initial.autoName };
    this.#listening = [...initial.detected];
  }

  async getSnapshot(): Promise<Result<Snapshot, ApiError>> {
    return ok(this.#snapshot);
  }

  subscribe(listener: SnapshotListener, onConnectionChange?: ConnectionListener): () => void {
    this.#listeners.add(listener);
    onConnectionChange?.("open");
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Replaces the whole state and notifies subscribers, as a server push would. */
  emit(snapshot: Snapshot): void {
    this.#listening = [...snapshot.detected];
    this.#config = { ...this.#config, autoName: snapshot.autoName };
    this.#publish(snapshot);
  }

  /** A new dev server starts answering HTTP; auto mode names it after a moment. */
  startServer(port: DetectedPort): void {
    this.#listening = [...this.#listening.filter((item) => item.port !== port.port), port];
    this.#update(this.#snapshot.routes);
    if (this.#config.autoName) this.#scheduleAutoName([port.port]);
  }

  async createAlias(request: CreateAliasRequest): Promise<Result<null, ApiError>> {
    const name = parseRouteName(request.name);
    if (!name.ok)
      return err({ error: "invalid_name", message: `"${request.name}" is not a valid name.` });
    const port = parsePort(request.port);
    if (!port.ok)
      return err({ error: "invalid_port", message: `${request.port} is not a valid port.` });

    const existing = this.#find(name.value);
    if (existing && !request.force) {
      return err({
        error: "name_taken",
        message: `${name.value} already points to port ${existing.port}.`,
      });
    }
    const routes = this.#snapshot.routes.filter((route) => route.name !== name.value);
    this.#update([...routes, this.#alias(name.value, port.value)]);
    return ok(null);
  }

  async renameAlias(
    currentName: string,
    request: RenameAliasRequest,
  ): Promise<Result<null, ApiError>> {
    const current = this.#find(currentName);
    if (!current) return err({ error: "not_found", message: `${currentName} does not exist.` });
    if (current.kind !== "alias")
      return err({ error: "not_an_alias", message: `${currentName} is an app, not an alias.` });
    const name = parseRouteName(request.name);
    if (!name.ok)
      return err({ error: "invalid_name", message: `"${request.name}" is not a valid name.` });
    if (name.value !== currentName && this.#find(name.value)) {
      return err({ error: "name_taken", message: `${name.value} is already taken.` });
    }
    this.#update(
      this.#snapshot.routes.map((route) =>
        route === current
          ? { ...this.#alias(name.value, route.port), registeredAt: route.registeredAt }
          : route,
      ),
    );
    return ok(null);
  }

  async removeAlias(name: string): Promise<Result<null, ApiError>> {
    const current = this.#find(name);
    if (!current) return err({ error: "not_found", message: `${name} does not exist.` });
    if (current.kind !== "alias")
      return err({ error: "not_an_alias", message: `${name} is an app, not an alias.` });
    this.#update(this.#snapshot.routes.filter((route) => route !== current));
    return ok(null);
  }

  /** Pretends to run npm: waits, then installs or fails with output like npm's. */
  async installPortless(): Promise<Result<InstallPortlessResponse, ApiError>> {
    if (this.#installing) {
      return err({ error: "install_in_progress", message: "portless is already being installed." });
    }
    this.#installing = true;
    await new Promise((resolve) => setTimeout(resolve, this.#options.installDelayMs ?? 1500));
    this.#installing = false;

    if (this.#options.installOutcome === "failure") {
      return err({
        error: "install_failed",
        message: [
          "npm exited with code 243.",
          "",
          "npm error code EACCES",
          "npm error syscall mkdir",
          "npm error path /usr/local/lib/node_modules/portless",
          "npm error errno -13",
        ].join("\n"),
      });
    }
    const portless = { installed: true, version: DEMO_PORTLESS_VERSION };
    this.#publish({ ...this.#snapshot, portless, readAt: this.#now() });
    return ok({ version: DEMO_PORTLESS_VERSION, output: "added 1 package in 1s" });
  }

  async getConfig(): Promise<Result<ConfigResponse, ApiError>> {
    return ok(this.#configResponse());
  }

  async updateConfig(config: StudioConfig): Promise<Result<ConfigResponse, ApiError>> {
    const parsed = parseConfig(config);
    if (!parsed.ok) return err({ error: "invalid_config", message: parsed.error });
    this.#config = parsed.value;
    this.#update(this.#snapshot.routes);
    return ok(this.#configResponse());
  }

  async ignoreDetected(port: number): Promise<Result<null, ApiError>> {
    const ignoredPorts = [...new Set([...this.#config.ignoredPorts, port])].sort((a, b) => a - b);
    this.#config = { ...this.#config, ignoredPorts };
    this.#update(this.#snapshot.routes);
    return ok(null);
  }

  #configResponse(): ConfigResponse {
    return { config: this.#config, path: this.#options.configPath ?? DEMO_CONFIG_PATH };
  }

  /** Names the given ports with their suggestion, the way the server's auto mode does. */
  #scheduleAutoName(ports: number[]): void {
    clearTimeout(this.#autoNameTimer);
    this.#autoNameTimer = setTimeout(async () => {
      for (const detected of this.#snapshot.detected) {
        if (!ports.includes(detected.port) || detected.suggestedName === null) continue;
        await this.createAlias({ name: detected.suggestedName, port: detected.port });
      }
    }, this.#options.autoNameDelayMs ?? 1500);
  }

  #find(name: string): Route | undefined {
    return this.#snapshot.routes.find((route) => route.name === name);
  }

  #alias(name: string, port: number): Route {
    const hostname = `${name}.${this.#snapshot.proxy.tlds[0] ?? "localhost"}`;
    return {
      hostname,
      name,
      port,
      kind: "alias",
      pid: null,
      registeredAt: this.#now(),
      url: routeUrl(hostname, this.#snapshot.proxy),
      tunnels: [],
    };
  }

  #update(routes: Route[]): void {
    const named = new Set(routes.map((route) => route.port));
    const ignoredProcesses = this.#config.ignoredProcesses.map((name) => name.toLowerCase());
    const detected = this.#listening.filter(
      (item) =>
        !named.has(item.port) &&
        !this.#config.ignoredPorts.includes(item.port) &&
        !ignoredProcesses.includes(item.processName.toLowerCase()),
    );
    this.#publish({
      ...this.#snapshot,
      routes,
      detected,
      autoName: this.#config.autoName,
      readAt: this.#now(),
    });
  }

  #publish(snapshot: Snapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
