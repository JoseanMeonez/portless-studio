import type {
  ApiError,
  ConfigResponse,
  CreateAliasRequest,
  CustomAppsResponse,
  DoctorFixResponse,
  DoctorReport,
  FocusAck,
  FocusEvent,
  InstallPortlessResponse,
  OpenWithApp,
  OpenWithRequest,
  ProxyAction,
  ProxyActionResponse,
  RenameAliasRequest,
  Snapshot,
  StudioAction,
  StudioActionResponse,
  StudioEvent,
} from "../../../../core/api/contract.ts";
import {
  DEFAULT_CONFIG,
  parseConfig,
  type StudioConfig,
} from "../../../../core/config/studio-config.ts";
import type { DoctorCheck } from "../../../../core/doctor/doctor-check.ts";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import {
  type CustomApp,
  customAppId,
  parseCustomApps,
} from "../../../../core/projects/custom-app.ts";
import { projectIconKind } from "../../../../core/projects/project-icon.ts";
import { err, ok, type Result } from "../../../../core/result.ts";
import { type Route, routeUrl } from "../../../../core/routes/route.ts";
import { parsePort, parseRouteName } from "../../../../core/routes/route-name.ts";
import type {
  ConnectionListener,
  EventListener,
  FocusListener,
  RoutesGateway,
  SnapshotListener,
} from "./routes-gateway.ts";

export type InMemoryRoutesGatewayOptions = {
  /** How long the fake `npm install -g portless` takes. */
  installDelayMs?: number;
  installOutcome?: "success" | "failure";
  /** How long auto mode waits before naming a newly detected port, like the server's next scan. */
  autoNameDelayMs?: number;
  /** Where the fake config file lives, shown in the settings panel. */
  configPath?: string;
  /** `root` shows a proxy started with sudo, which Studio cannot stop. */
  proxyOwner?: "you" | "root";
  /** Whether the fake Studio runs as a login service, so it can restart itself. */
  loginService?: boolean;
  /** Sends notifications for new servers and the names auto mode gives, as the server does. */
  events?: boolean;
};

export const DEMO_CONFIG_PATH = "~/.portless-studio/config.json";
const DEMO_OPEN_WITH_PATH = "~/.portless-studio/open-with.json";

/** What the fake machine has installed. */
const DEMO_APPS: readonly OpenWithApp[] = [
  { id: "vscode", name: "VS Code", kind: "editor" },
  { id: "zed", name: "Zed", kind: "editor" },
  { id: "file-manager", name: "File manager", kind: "file-manager" },
];

/** Version the fake install reports. */
export const DEMO_PORTLESS_VERSION = "0.4.2";

/**
 * `RoutesGateway` that keeps routes in memory. Tests use it to drive the UI, and `?demo` uses it
 * to show the app without a server. It follows the same rules as the real API.
 */
export class InMemoryRoutesGateway implements RoutesGateway {
  #snapshot: Snapshot;
  readonly #listeners = new Set<SnapshotListener>();
  readonly #eventListeners = new Set<EventListener>();
  readonly #focusListeners = new Set<FocusListener>();
  /** What pages answered to focus requests, in order; tests read them. */
  readonly focusAcks: FocusAck[] = [];
  #events: StudioEvent[] = [];
  #eventCount = 0;
  readonly #now: () => number;
  readonly #options: InMemoryRoutesGatewayOptions;
  #installing = false;
  #config: StudioConfig;
  // Every port listening on the fake machine; `snapshot.detected` is the part not named or ignored.
  #listening: DetectedPort[];
  #autoNameTimer: ReturnType<typeof setTimeout> | undefined;
  #proxyOwner: "you" | "root";
  /** Folders opened through `openWith`, in order; tests read them. */
  readonly openedWith: OpenWithRequest[] = [];
  /** Apps added in Settings. */
  customApps: CustomApp[] = [];

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
    this.#proxyOwner = options.proxyOwner ?? "you";
  }

  async getSnapshot(): Promise<Result<Snapshot, ApiError>> {
    return ok(this.#snapshot);
  }

  subscribe(
    listener: SnapshotListener,
    onConnectionChange?: ConnectionListener,
    onEvent?: EventListener,
    onFocus?: FocusListener,
  ): () => void {
    this.#listeners.add(listener);
    if (onFocus) this.#focusListeners.add(onFocus);
    onConnectionChange?.("open");
    if (onEvent) {
      this.#eventListeners.add(onEvent);
      // Like the server, a new connection first gets the recent events.
      for (const event of this.#events) onEvent(event);
    }
    return () => {
      this.#listeners.delete(listener);
      if (onEvent) this.#eventListeners.delete(onEvent);
      if (onFocus) this.#focusListeners.delete(onFocus);
    };
  }

  /** Asks open pages to show a target and come forward, as `portless-studio open` does. */
  focus(event: FocusEvent): void {
    for (const listener of this.#focusListeners) listener(event);
  }

  async acknowledgeFocus(ack: FocusAck): Promise<Result<null, ApiError>> {
    this.focusAcks.push(ack);
    return ok(null);
  }

  /** Sends a notification, as the server does for a notable change. */
  emitEvent(event: StudioEvent): void {
    this.#events = [...this.#events, event].slice(-50);
    for (const listener of this.#eventListeners) listener(event);
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
    this.#demoEvent({
      kind: "detected",
      title: `New server on port ${port.port}`,
      body: port.suggestedName
        ? `${port.processName}, suggested name ${port.suggestedName}`
        : `${port.processName}, no name suggested`,
      target: { port: port.port },
    });
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

  async getDoctor(): Promise<Result<DoctorReport, ApiError>> {
    return ok({ checks: this.#checks() });
  }

  /** Runs the fake fixes the way the server would: only actions the checks offer right now. */
  async runDoctorFix(id: string): Promise<Result<DoctorFixResponse, ApiError>> {
    const action = this.#checks().find((check) => check.id === id)?.fix?.action;
    if (!action)
      return err({ error: "not_found", message: `There is no fix Studio can run for "${id}".` });
    let message: string;
    if (action === "use-http-1355") {
      this.#config = { ...this.#config, proxyPort: 1355, proxyHttps: false };
      if (this.#proxyOwner === "root" && this.#snapshot.proxy.running) {
        message =
          "Saved HTTP on port 1355. Stop the current proxy with `sudo portless proxy stop`.";
      } else {
        this.#setProxy({ running: true, port: 1355, https: false });
        message = "Restarted the proxy on port 1355.";
      }
    } else {
      const done = await this.controlProxy(action === "start-proxy" ? "start" : "restart");
      if (!done.ok) return done;
      message = done.value.message;
    }
    return ok({ message, checks: this.#checks() });
  }

  async controlProxy(action: ProxyAction): Promise<Result<ProxyActionResponse, ApiError>> {
    const { proxy } = this.#snapshot;
    if (action !== "start" && proxy.running && this.#proxyOwner === "root") {
      return err({
        error: "needs_admin",
        message: "The proxy runs as root (pid 3694271), so stopping it needs sudo.",
        command: "sudo portless proxy stop",
      });
    }
    if (action === "stop") {
      this.#setProxy({ running: false });
      return ok({ message: "Stopped the proxy." });
    }
    const port = this.#config.proxyPort;
    this.#proxyOwner = "you";
    this.#setProxy({ running: true, port, https: this.#config.proxyHttps });
    return ok({
      message:
        action === "restart"
          ? `Restarted the proxy on port ${port}.`
          : `Started the proxy on port ${port}.`,
    });
  }

  async controlStudio(action: StudioAction): Promise<Result<StudioActionResponse, ApiError>> {
    const service = this.#options.loginService ?? true;
    if (action === "restart" && !service) {
      return err({
        error: "unsupported",
        message: "Studio was started from a terminal, so nothing would start it again.",
        command: "portless-studio service install",
      });
    }
    return ok({
      message: action === "restart" ? "Studio is restarting." : "Studio is stopping.",
      startCommand: service ? "systemctl --user start portless-studio" : "portless-studio",
    });
  }

  /** Stops a fake dev server: a detected port disappears, a route stops answering. */
  async stopProcess(pid: number): Promise<Result<null, ApiError>> {
    const detected = this.#listening.find((item) => item.pid === pid);
    const route = this.#snapshot.routes.find((item) => item.listenerPid === pid);
    if (!detected && !route) {
      return err({
        error: "process_not_allowed",
        message: `Process ${pid} does not serve a port Studio shows.`,
      });
    }
    this.#listening = this.#listening.filter((item) => item.pid !== pid);
    const routes = this.#snapshot.routes.map((item) => {
      if (item.listenerPid !== pid) return item;
      const { listenerPid: _stopped, ...rest } = item;
      return { ...rest, health: { state: "down" as const, checkedAt: this.#now() } };
    });
    this.#update(routes);
    return ok(null);
  }

  async listOpenWithApps(): Promise<Result<OpenWithApp[], ApiError>> {
    const custom = this.customApps.map((app, index) => ({
      id: customAppId(index),
      name: app.name,
      kind: "custom" as const,
    }));
    return ok([...DEMO_APPS, ...custom]);
  }

  /** Records the request; like the server, only folders of shown items and known apps pass. */
  async openWith(request: OpenWithRequest): Promise<Result<null, ApiError>> {
    const { routes, detected } = this.#snapshot;
    const folders = new Set<string>();
    for (const item of [...routes, ...detected])
      if (item.project?.path) folders.add(item.project.path);
    for (const item of detected) if (item.cwd) folders.add(item.cwd);
    if (!folders.has(request.path)) {
      return err({ error: "path_not_allowed", message: "Studio only opens the folders it shows." });
    }
    const apps = await this.listOpenWithApps();
    if (!apps.ok || !apps.value.some((app) => app.id === request.appId)) {
      return err({ error: "unknown_app", message: "That app is not on this machine anymore." });
    }
    this.openedWith.push({ ...request });
    return ok(null);
  }

  async getCustomApps(): Promise<Result<CustomAppsResponse, ApiError>> {
    return ok({ apps: this.customApps, path: DEMO_OPEN_WITH_PATH });
  }

  async updateCustomApps(apps: CustomApp[]): Promise<Result<CustomAppsResponse, ApiError>> {
    const parsed = parseCustomApps(apps);
    if (!parsed.ok) return err({ error: "invalid_request", message: parsed.error });
    this.customApps = parsed.value;
    return ok({ apps: this.customApps, path: DEMO_OPEN_WITH_PATH });
  }

  /** The checks the demo machine fails, built from the fake state like the server's doctor. */
  #checks(): DoctorCheck[] {
    const { proxy, portless } = this.#snapshot;
    const checks: DoctorCheck[] = [
      portless.installed
        ? {
            id: "portless",
            status: "ok",
            title: `portless ${portless.version ?? ""} is installed`.replace("  ", " "),
            detail: "Studio names ports and starts the proxy through it.",
          }
        : {
            id: "portless",
            status: "fail",
            title: "portless is not installed",
            detail: "Without it no port gets a name. Install it, then run the checks again.",
            fix: { label: "Install portless", command: "npm install -g portless" },
          },
      {
        id: "config",
        status: "ok",
        title: "The config file is valid",
        detail: this.#options.configPath ?? DEMO_CONFIG_PATH,
      },
    ];
    if (portless.installed) {
      checks.push(
        proxy.running
          ? {
              id: "proxy-running",
              status: "ok",
              title: "The proxy is running",
              detail: `It serves ${proxy.https ? "HTTPS" : "HTTP"} on port ${proxy.port}.`,
            }
          : {
              id: "proxy-running",
              status: "warn",
              title: "The proxy is not running",
              detail: "Names do not open until it runs.",
              fix: {
                label: `Start the proxy on port ${this.#config.proxyPort}`,
                action: "start-proxy",
                command: `portless proxy start --port ${this.#config.proxyPort} --no-tls`,
              },
            },
      );
      if (proxy.running && this.#proxyOwner === "root") {
        checks.push({
          id: "proxy-owner",
          status: "warn",
          title: "The proxy runs as root",
          detail:
            "It was started with sudo (pid 3694271, port 443), so Studio cannot stop or restart " +
            "it. Stop it once; Studio then starts its own proxy over HTTP on port 1355.",
          fix: { label: "Stop it once with sudo", command: "sudo portless proxy stop" },
        });
      } else if (proxy.running) {
        checks.push({
          id: "proxy-owner",
          status: "ok",
          title: "The proxy runs as you",
          detail: "Studio can stop and restart it.",
          fix: { label: "Restart the proxy", action: "restart-proxy" },
        });
      }
      if (proxy.running && proxy.https) {
        checks.push({
          id: "https-trust",
          status: "warn",
          title: "Chrome may not trust the HTTPS certificate",
          detail:
            "The portless certificate is not in Chrome's certificate store. On Linux, Chrome " +
            "reads ~/.pki/nssdb and not the system store, so names show " +
            "ERR_CERT_AUTHORITY_INVALID.",
          fix: { label: "Switch to HTTP on port 1355", action: "use-http-1355" },
        });
      }
    }
    checks.push({
      id: "studio-port",
      status: "ok",
      title: `Studio answers on port ${this.#config.port}`,
      detail: "Its port belongs to Studio.",
    });
    return checks;
  }

  #setProxy(change: Partial<Snapshot["proxy"]>): void {
    const proxy = { ...this.#snapshot.proxy, ...change };
    const routes = this.#snapshot.routes.map((route) => ({
      ...route,
      url: routeUrl(route.hostname, proxy),
    }));
    this.#publish({ ...this.#snapshot, proxy, routes, readAt: this.#now() });
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
        const name = detected.suggestedName;
        const created = await this.createAlias({ name, port: detected.port });
        if (created.ok) {
          this.#demoEvent({
            kind: "named",
            title: `Named ${name}`,
            body: `Port ${detected.port} opens at ${this.#find(name)?.url ?? name}`,
            target: { route: name, port: detected.port },
          });
        }
      }
    }, this.#options.autoNameDelayMs ?? 1500);
  }

  #demoEvent(draft: Omit<StudioEvent, "id" | "at">): void {
    if (!this.#options.events) return;
    this.#eventCount += 1;
    this.emitEvent({ ...draft, id: `demo-${this.#eventCount}`, at: Date.now() });
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
      routes: routes.map((route) => this.#withIcon(route)),
      detected: detected.map((item) => this.#withIcon(item)),
      projectIcons: this.#demoIcons(),
      autoName: this.#config.autoName,
      readAt: this.#now(),
    });
  }

  /**
   * The demo has no servers to read favicons from, so it shows the emoji and data URLs set in the
   * config; a route loses its icon again when the config drops it.
   */
  #withIcon<T extends { project?: { name: string } | null; icon?: string }>(item: T): T {
    const name = item.project?.name;
    const own = name ? this.#demoIcons()[name] : undefined;
    if (own !== undefined) return { ...item, icon: own };
    if (item.icon === undefined || !name || "processName" in item) return item;
    const { icon: _dropped, ...rest } = item;
    return rest as T;
  }

  #demoIcons(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.#config.projectIcons).filter(([, icon]) => {
        const kind = projectIconKind(icon);
        return kind === "text" || kind === "image";
      }),
    );
  }

  #publish(snapshot: Snapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
