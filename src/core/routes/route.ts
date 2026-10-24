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
};

export type ProxyStatus = {
  running: boolean;
  /** Port the proxy listens on, `null` when it never ran. */
  port: number | null;
  https: boolean;
  /** TLDs the proxy serves, the first one is the default (usually `localhost`). */
  tlds: string[];
};

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
