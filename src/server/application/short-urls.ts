import type { StudioConfig } from "../../core/config/studio-config.ts";
import type { Result } from "../../core/result.ts";
import { withPublicPort } from "../../core/routes/route.ts";
import type { RouteRegistry } from "./route-registry.ts";

/** The port browsers use when a URL has none. */
export const SHORT_URL_PORT = 80;

/**
 * Whether names open without a port number through Studio:
 * - `off`: `shortUrls` is false.
 * - `https`: the proxy serves HTTPS, and a URL without a port means 443 there.
 * - `proxy-on-port`: the proxy itself listens on the short-URL port, so nothing to forward.
 * - `listening`: Studio listens on `port` and forwards to the proxy on `target`.
 * - `failed`: Studio could not listen; names keep the proxy port.
 */
export type ShortUrlStatus =
  | { state: "off" }
  | { state: "https" }
  | { state: "proxy-on-port" }
  | { state: "listening"; port: number; target: number }
  | { state: "failed"; port: number; reason: "denied" | "in-use" | "failed"; message: string };

/** Listens on a port and forwards every connection to the proxy; `node:net` in production. */
export interface ForwardingPort {
  listen(
    port: number,
    target: number,
  ): Promise<
    Result<
      { port: number; close(): Promise<void> },
      { reason: "denied" | "in-use" | "failed"; message: string }
    >
  >;
}

export type ShortUrlsOptions = {
  forwarding: ForwardingPort;
  /** 80 by default; `PORTLESS_STUDIO_SHORT_URL_PORT` changes it, so tests never bind port 80. */
  port?: number;
  log: (line: string) => void;
  /**
   * Whether a request to this loopback port reaches the portless proxy. Lets a command that runs
   * outside the Studio server, such as `doctor`, tell whether Studio's forwarder listens.
   */
  reachesProxy?: (port: number) => Promise<boolean>;
};

/**
 * Keeps Studio's port-80 forwarder in line with the config. portless asks for sudo to start its
 * proxy below port 1024 on Linux and macOS even where the system allows the bind, so the proxy
 * stays on `proxyPort` and Studio listens on port 80 itself, as the current user, never with sudo.
 */
export class ShortUrls {
  readonly #forwarding: ForwardingPort;
  readonly #port: number;
  readonly #log: (line: string) => void;
  readonly #reachesProxy: ((port: number) => Promise<boolean>) | null;
  readonly #watchers = new Set<() => void>();
  #running: { target: number; port: number; close(): Promise<void> } | null = null;
  #status: ShortUrlStatus = { state: "off" };
  #queue: Promise<unknown> = Promise.resolve();
  #synced = false;

  constructor(options: ShortUrlsOptions) {
    this.#forwarding = options.forwarding;
    this.#port = options.port ?? SHORT_URL_PORT;
    this.#log = options.log;
    this.#reachesProxy = options.reachesProxy ?? null;
  }

  /** The port Studio listens on for short URLs, whether or not it listens right now. */
  get port(): number {
    return this.#port;
  }

  /** True once a sync ran in this process; a CLI command that never syncs has to ask elsewhere. */
  get synced(): boolean {
    return this.#synced;
  }

  /** The port in route URLs while the forwarder listens; null keeps the proxy port. */
  publicPort(): number | null {
    return this.#running?.port ?? null;
  }

  status(): ShortUrlStatus {
    return this.#status;
  }

  /**
   * The status for the doctor. In the server it is this process's own; elsewhere Studio may run
   * in another process, so port 80 is asked whether it reaches the proxy. Undefined when unknown.
   */
  async inspect(config: StudioConfig): Promise<ShortUrlStatus | undefined> {
    if (this.#synced) return this.#status;
    const wanted = this.#wanted(config);
    if (wanted.state !== "listening") return wanted;
    const reached = await (this.#reachesProxy?.(this.#port) ?? Promise.resolve(false));
    return reached ? wanted : undefined;
  }

  /** Calls `onChange` when the public port changes. Returns an unsubscribe. */
  onChange(onChange: () => void): () => void {
    this.#watchers.add(onChange);
    return () => this.#watchers.delete(onChange);
  }

  /**
   * Listens, moves or stops to match the config, one sync at a time. A failed listen is tried
   * again on the next sync, so a doctor fix or a config save after `sysctl` picks it up.
   */
  sync(config: StudioConfig): Promise<ShortUrlStatus> {
    const next = this.#queue.then(() => this.#sync(config));
    this.#queue = next.catch(() => {});
    return next;
  }

  close(): Promise<void> {
    const next = this.#queue.then(async () => {
      await this.#stop();
      this.#status = { state: "off" };
    });
    this.#queue = next.catch(() => {});
    return next;
  }

  async #sync(config: StudioConfig): Promise<ShortUrlStatus> {
    this.#synced = true;
    const wanted = this.#wanted(config);
    if (wanted.state !== "listening") {
      await this.#stop();
      this.#status = wanted;
      return wanted;
    }
    const target = config.proxyPort;
    if (this.#running?.target === target) return this.#status;
    await this.#stop();
    const started = await this.#forwarding.listen(this.#port, target);
    if (!started.ok) {
      this.#status = { state: "failed", port: this.#port, ...started.error };
      this.#log(`short URLs are off: ${started.error.message} Names keep :${target}.`);
      return this.#status;
    }
    this.#running = { target, port: started.value.port, close: started.value.close };
    this.#status = { state: "listening", port: started.value.port, target };
    this.#log(`short URLs: port ${started.value.port} forwards to the proxy on port ${target}`);
    this.#changed();
    return this.#status;
  }

  #wanted(config: StudioConfig): ShortUrlStatus {
    if (!config.shortUrls) return { state: "off" };
    if (config.proxyHttps) return { state: "https" };
    if (config.proxyPort === this.#port) return { state: "proxy-on-port" };
    return { state: "listening", port: this.#port, target: config.proxyPort };
  }

  async #stop(): Promise<void> {
    const running = this.#running;
    if (!running) return;
    this.#running = null;
    await running.close();
    this.#changed();
  }

  #changed(): void {
    for (const watcher of this.#watchers) watcher();
  }
}

/**
 * The registry the rest of Studio reads: the same routes, with URLs on the public port while the
 * forwarder listens, so the page, the CLI, MCP and notifications all show the URL that opens.
 */
export function publicUrls(
  registry: RouteRegistry,
  publicPort: () => number | null,
): RouteRegistry {
  return {
    readSnapshot: async () => withPublicPort(await registry.readSnapshot(), publicPort()),
    watch: (onChange) => registry.watch(onChange),
    createAlias: (name, port, force) => registry.createAlias(name, port, force),
    removeAlias: (name) => registry.removeAlias(name),
    installPortless: () => registry.installPortless(),
    startProxy: (port, https) => registry.startProxy(port, https),
    stopProxy: () => registry.stopProxy(),
    proxyPid: () => registry.proxyPid(),
  };
}
