import * as fs from "node:fs";
import type { Snapshot } from "../../../core/api/contract.ts";
import type { Result } from "../../../core/result.ts";
import type { AppError } from "../../application/app-error.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import { addAlias, type PortlessCli, removeAlias } from "./portless-cli.ts";
import { readProxyStatus, readRoutes } from "./state-files.ts";

export type PortlessRegistryOptions = {
  stateDir: string;
  /** Path or command name of the portless binary used for writes. */
  bin: string;
  /** Waits for a burst of file events to settle before reading. */
  debounceMs?: number;
  /** Catches what file events miss: apps that exit, platforms where fs.watch is unreliable. */
  pollMs?: number;
};

/** Reads portless state files directly and writes through the portless CLI, which owns the lock. */
export class PortlessRegistry implements RouteRegistry {
  readonly #stateDir: string;
  readonly #cli: PortlessCli;
  readonly #debounceMs: number;
  readonly #pollMs: number;

  constructor(options: PortlessRegistryOptions) {
    this.#stateDir = options.stateDir;
    this.#cli = { bin: options.bin, stateDir: options.stateDir };
    this.#debounceMs = options.debounceMs ?? 100;
    this.#pollMs = options.pollMs ?? 2000;
  }

  async readSnapshot(): Promise<Snapshot> {
    const proxy = readProxyStatus(this.#stateDir);
    return { proxy, routes: readRoutes(this.#stateDir, proxy), readAt: Date.now() };
  }

  watch(onChange: () => void): () => void {
    let last = this.#fingerprint();
    let debounce: NodeJS.Timeout | undefined;

    const check = () => {
      const next = this.#fingerprint();
      if (next === last) return;
      last = next;
      onChange();
    };
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
    const poll = setInterval(check, this.#pollMs);
    poll.unref();

    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      watcher?.close();
    };
  }

  createAlias(name: string, port: number, force: boolean): Promise<Result<void, AppError>> {
    return addAlias(this.#cli, name, port, force);
  }

  removeAlias(name: string): Promise<Result<void, AppError>> {
    return removeAlias(this.#cli, name);
  }

  /** The snapshot without its read time, so two reads of the same state compare equal. */
  #fingerprint(): string {
    const proxy = readProxyStatus(this.#stateDir);
    return JSON.stringify({ proxy, routes: readRoutes(this.#stateDir, proxy) });
  }
}
