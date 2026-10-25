import type { DetectedPort } from "../core/ports/detected-port.ts";
import type { ProxyStatus, Route } from "../core/routes/route.ts";

/** The flat shape `list --json` and the MCP tools print for a route. */
export type RouteItem = {
  name: string;
  url: string;
  port: number;
  kind: Route["kind"];
  /** `unknown` until Studio has probed the port. */
  health: "up" | "error" | "down" | "unknown";
  project: string | null;
  worktree: string | null;
  /** The process listening on the port, or the one portless recorded. */
  pid: number | null;
  /** When that process started, in epoch milliseconds; null when unknown or nothing listens. */
  startedAt: number | null;
};

/** The flat shape `list --json` and the MCP tools print for a port without a name. */
export type DetectedItem = {
  port: number;
  pid: number | null;
  process: string;
  folder: string | null;
  suggestedName: string | null;
  project: string | null;
  worktree: string | null;
  /** When the process started, in epoch milliseconds; null when unknown. */
  startedAt: number | null;
};

export function routeItem(route: Route): RouteItem {
  return {
    name: route.name,
    url: route.url,
    port: route.port,
    kind: route.kind,
    health: route.health?.state ?? "unknown",
    project: route.project?.name ?? null,
    worktree: route.project?.worktree ?? null,
    pid: route.listenerPid ?? route.pid,
    startedAt: route.startedAt ?? null,
  };
}

export function detectedItem(port: DetectedPort): DetectedItem {
  return {
    port: port.port,
    pid: port.pid,
    process: port.processName,
    folder: port.cwd,
    suggestedName: port.suggestedName,
    project: port.project?.name ?? null,
    worktree: port.project?.worktree ?? null,
    startedAt: port.startedAt ?? null,
  };
}

export function proxyItem(proxy: ProxyStatus): {
  running: boolean;
  port: number | null;
  publicPort?: number;
} {
  const item = { running: proxy.running, port: proxy.port };
  return proxy.publicPort == null ? item : { ...item, publicPort: proxy.publicPort };
}

/** `publicPort` is set while Studio forwards it to the proxy, for URLs without a port. */
export function describeProxy(proxy: ProxyStatus): string {
  if (!proxy.running) return "proxy stopped";
  const running = proxy.port === null ? "proxy running" : `proxy running on port ${proxy.port}`;
  return proxy.publicPort == null ? running : `${running}, names open on port ${proxy.publicPort}`;
}
