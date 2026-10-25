import * as fs from "node:fs";
import type { InstallPortlessResponse, PortlessInstallation } from "../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../core/result.ts";
import type { ProxyStatus, Route } from "../../../core/routes/route.ts";
import { type AppError, appError } from "../../application/app-error.ts";
import type { PortlessState, RouteRegistry } from "../../application/route-registry.ts";
import {
  addAlias,
  detectPortless,
  installPortless,
  type PortlessCli,
  removeAlias,
  startProxy,
  stopProxy,
} from "./portless-cli.ts";
import {
  readProxyPid,
  readProxyStatus,
  readRouteEntries,
  routesFromEntries,
} from "./state-files.ts";

/** How long a write waits for a half-written `routes.json` to be whole again. */
const TORN_RETRIES = 10;
const TORN_RETRY_MS = 50;

export type PortlessRegistryOptions = {
  stateDir: string;
  /** Path or command name of the portless binary used for writes. */
  bin: string;
  /** Waits for a burst of file events to settle before reading. */
  debounceMs?: number;
  /** Catches what file events miss: apps that exit, platforms where fs.watch is unreliable. */
  pollMs?: number;
  /** npm command used to install portless; tests point it at a fake. */
  npmBin?: string;
  /** How long a `portless --version` result is reused, so reads do not spawn a process each time. */
  detectTtlMs?: number;
};

type CachedInstallation = { value: PortlessInstallation; at: number };

/** Reads portless state files directly and writes through the portless CLI, which owns the lock. */
export class PortlessRegistry implements RouteRegistry {
  readonly #stateDir: string;
  readonly #cli: PortlessCli;
  readonly #debounceMs: number;
  readonly #pollMs: number;
  readonly #npmBin: string;
  readonly #detectTtlMs: number;
  #installation: CachedInstallation | null = null;
  #detecting: Promise<PortlessInstallation> | null = null;
  // Bumped by an install, so a detection that started before it cannot cache a stale answer.
  #detectGeneration = 0;
  #installing = false;
  /** The entries of the last `routes.json` that parsed, shown while portless rewrites it. */
  #lastEntries: unknown[] = [];
  /** One per watcher: compares the installation with what that watcher last saw. */
  readonly #installationChecks = new Set<() => Promise<void>>();

  constructor(options: PortlessRegistryOptions) {
    this.#stateDir = options.stateDir;
    this.#cli = { bin: options.bin, stateDir: options.stateDir };
    this.#debounceMs = options.debounceMs ?? 100;
    this.#pollMs = options.pollMs ?? 2000;
    this.#npmBin = options.npmBin ?? "npm";
    this.#detectTtlMs = options.detectTtlMs ?? 30_000;
  }

  async readSnapshot(): Promise<PortlessState> {
    const portless = await this.#detect();
    const proxy = readProxyStatus(this.#stateDir);
    return { proxy, portless, routes: this.#routes(proxy), readAt: Date.now() };
  }

  watch(onChange: () => void): () => void {
    let last = this.#fingerprint();
    let debounce: NodeJS.Timeout | undefined;
    // Unknown until the first detection, which sets the baseline without notifying.
    let lastInstallation: string | null = null;
    let latestCheck = 0;

    const check = () => {
      const next = this.#fingerprint();
      if (next === last) return;
      last = next;
      onChange();
    };
    const checkInstallation = async () => {
      const ticket = ++latestCheck;
      const detected = await this.#detect();
      // A newer check, such as the one after an install, already has a fresher answer.
      if (ticket !== latestCheck) return;
      const next = JSON.stringify(detected);
      if (lastInstallation !== null && next !== lastInstallation) onChange();
      lastInstallation = next;
    };
    this.#installationChecks.add(checkInstallation);
    void checkInstallation();
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(check, this.#debounceMs);
    };

    let watcher: fs.FSWatcher | undefined;
    try {
      watcher = fs.watch(this.#stateDir, schedule);
      // A deleted or unreadable directory stops events; polling keeps working.
      watcher.on("error", () => watcher?.close());
    } catch {
      watcher = undefined;
    }
    // Detection is cached, so polling spawns `portless --version` at most once per TTL.
    const poll = setInterval(() => {
      check();
      void checkInstallation();
    }, this.#pollMs);
    poll.unref();

    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      watcher?.close();
      this.#installationChecks.delete(checkInstallation);
    };
  }

  async installPortless(): Promise<Result<InstallPortlessResponse, AppError>> {
    if (this.#installing) {
      return err(appError("install_in_progress", "portless is already being installed."));
    }
    this.#installing = true;
    try {
      const installed = await installPortless(this.#npmBin, this.#stateDir);
      this.#forgetInstallation();
      if (!installed.ok) return installed;
      const { version } = await this.#detect();
      await Promise.all(
        [...this.#installationChecks].map((checkInstallation) => checkInstallation()),
      );
      return ok({ version, output: installed.value.output });
    } finally {
      this.#installing = false;
    }
  }

  async createAlias(name: string, port: number, force: boolean): Promise<Result<void, AppError>> {
    // `portless alias` silently replaces an existing alias, so the conflict check lives here.
    await this.#waitForWholeRoutesFile();
    const proxy = readProxyStatus(this.#stateDir);
    const existing = this.#routes(proxy).find((route) => route.name === name);
    if (existing && !force) {
      if (existing.port === port) return ok(undefined);
      return err(appError("name_taken", `"${name}" already points to port ${existing.port}.`));
    }
    return addAlias(this.#cli, name, port, force);
  }

  startProxy(port: number, https: boolean): Promise<Result<void, AppError>> {
    return startProxy(this.#cli, port, https);
  }

  stopProxy(): Promise<Result<void, AppError>> {
    return stopProxy(this.#cli);
  }

  async proxyPid(): Promise<number | null> {
    return readProxyPid(this.#stateDir);
  }

  removeAlias(name: string): Promise<Result<void, AppError>> {
    return removeAlias(this.#cli, name);
  }

  #detect(): Promise<PortlessInstallation> {
    const cached = this.#installation;
    if (cached && Date.now() - cached.at < this.#detectTtlMs) return Promise.resolve(cached.value);
    if (this.#detecting) return this.#detecting;
    const generation = this.#detectGeneration;
    const detecting = detectPortless(this.#cli).then((value) => {
      if (generation === this.#detectGeneration) {
        this.#installation = { value, at: Date.now() };
        this.#detecting = null;
      }
      return value;
    });
    this.#detecting = detecting;
    return detecting;
  }

  #forgetInstallation(): void {
    this.#detectGeneration += 1;
    this.#installation = null;
    this.#detecting = null;
  }

  /** The snapshot without its read time, so two reads of the same state compare equal. */
  #fingerprint(): string {
    const proxy = readProxyStatus(this.#stateDir);
    return JSON.stringify({ proxy, routes: this.#routes(proxy) });
  }

  /**
   * Routes from `routes.json`. portless rewrites the file in place, so a read can land on an empty
   * or cut-off file; that read keeps the last entries that parsed, and the next file event or poll
   * reads it again. A missing file, or one in a format Studio does not know, means no routes.
   */
  #routes(proxy: ProxyStatus): Route[] {
    const read = readRouteEntries(this.#stateDir);
    if (read.kind === "ok") this.#lastEntries = read.entries;
    else if (read.kind !== "torn") this.#lastEntries = [];
    return routesFromEntries(this.#lastEntries, proxy);
  }

  /** Gives portless a moment to finish a write, so a name check never runs on a torn file. */
  async #waitForWholeRoutesFile(): Promise<void> {
    for (let attempt = 0; attempt < TORN_RETRIES; attempt += 1) {
      if (readRouteEntries(this.#stateDir).kind !== "torn") return;
      await new Promise((resolve) => setTimeout(resolve, TORN_RETRY_MS));
    }
  }
}
