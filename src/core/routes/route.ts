/** `app` is a dev server portless started; `alias` is a name given to a port by hand. */
export type RouteKind = "app" | "alias";

export type TunnelProvider = "tailscale" | "ngrok" | "cloudflare";

export type Tunnel = {
  provider: TunnelProvider;
  url: string;
};

export type Route = {
  /** Full hostname the proxy answers to, e.g. `api.acme.localhost`. */
  hostname: string;
  /** Hostname without the TLD, e.g. `api.acme`. This is what people call the route. */
  name: string;
  /** Local port the proxy forwards to. */
  port: number;
  kind: RouteKind;
  /** Process that owns the route. `null` for aliases, which have no process. */
  pid: number | null;
  /** Epoch milliseconds, `null` for routes registered by older portless versions. */
  registeredAt: number | null;
  /** URL to open in the browser, including the proxy port when it is not the default one. */
  url: string;
  tunnels: Tunnel[];
  /** Process listening on `port`, when the port scan could see it. Absent when unknown. */
  listenerPid?: number;
  /** Whether `port` answers HTTP, from the last probe. Absent until the first probe. */
  health?: RouteHealth;
  /**
   * Project the listening process runs in, read from its folder. `null` when the folder is not a
   * project or cannot be read; absent from servers older than this field.
   */
  project?: ItemProject | null;
};

/** The repository (or package) a server runs from, and its linked git worktree if any. */
export type ItemProject = {
  /** Repository folder name, e.g. `acme-monorepo`, or the package name without a repository. */
  name: string;
  /** Folder of the linked git worktree, e.g. `falcon`; null in the main checkout. */
  worktree: string | null;
};

/** `up` answered below 500, `error` answered 5xx, `down` did not answer at all. */
export type RouteHealthState = "up" | "error" | "down";

export type RouteHealth = {
  state: RouteHealthState;
  /** HTTP status of the answer; absent when the port did not answer. */
  status?: number;
  /** How long the answer took, in milliseconds; absent when the port did not answer. */
  latencyMs?: number;
  /** Epoch milliseconds of the probe. */
  checkedAt: number;
};

export type ProxyStatus = {
  running: boolean;
  /** Port the proxy listens on, `null` when it never ran. */
  port: number | null;
  https: boolean;
  /** TLDs the proxy serves, the first one is the default (usually `localhost`). */
  tlds: string[];
};

/** Maps one HTTP probe to a health state; `null` means nothing answered. */
export function healthFromProbe(
  probe: { status: number; latencyMs: number } | null,
  checkedAt: number,
): RouteHealth {
  if (probe === null) return { state: "down", checkedAt };
  return {
    state: probe.status >= 500 ? "error" : "up",
    status: probe.status,
    latencyMs: probe.latencyMs,
    checkedAt,
  };
}

/** Removes the first TLD the hostname ends with: `api.acme.localhost` -> `api.acme`. */
export function nameFromHostname(hostname: string, tlds: readonly string[]): string {
  for (const tld of tlds) {
    const suffix = `.${tld}`;
    if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
      return hostname.slice(0, -suffix.length);
    }
  }
  return hostname;
}

/** Builds the browser URL; omits the port when it is the protocol default. */
export function routeUrl(hostname: string, proxy: Pick<ProxyStatus, "port" | "https">): string {
  const scheme = proxy.https ? "https" : "http";
  const defaultPort = proxy.https ? 443 : 80;
  const port = proxy.port === null || proxy.port === defaultPort ? "" : `:${proxy.port}`;
  return `${scheme}://${hostname}${port}`;
}
