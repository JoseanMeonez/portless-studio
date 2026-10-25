import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  nameFromHostname,
  type ProxyStatus,
  type Route,
  routeUrl,
  type Tunnel,
  type TunnelProvider,
} from "../../../core/routes/route.ts";

// File names inside the portless state directory, as portless writes them.
const ROUTES_FILE = "routes.json";
const PORT_FILE = "proxy.port";
const PID_FILE = "proxy.pid";
const TLS_MARKER_FILE = "proxy.tls";
const TLDS_FILE = "proxy.tlds";
const TLD_FILE = "proxy.tld";
const DEFAULT_TLD = "localhost";

const TUNNEL_FIELDS: ReadonlyArray<[TunnelProvider, string]> = [
  ["tailscale", "tailscaleUrl"],
  ["ngrok", "ngrokUrl"],
  ["cloudflare", "cloudflareUrl"],
];

/** Same rule portless uses: `PORTLESS_STATE_DIR`, otherwise `~/.portless`. */
export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PORTLESS_STATE_DIR || path.join(os.homedir(), ".portless");
}

export function readProxyStatus(dir: string): ProxyStatus {
  const port = toPort(Number.parseInt(readText(dir, PORT_FILE) ?? "", 10));
  const pid = readProxyPid(dir);
  return {
    running: pid !== null && isProcessAlive(pid),
    port,
    https: fs.existsSync(path.join(dir, TLS_MARKER_FILE)),
    tlds: readTlds(dir),
  };
}

/** The pid in `proxy.pid`, alive or not; null when the file is missing or holds no pid. */
export function readProxyPid(dir: string): number | null {
  const pid = Number.parseInt(readText(dir, PID_FILE) ?? "", 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * What `routes.json` holds. portless rewrites it in place, so an empty or cut-off file usually
 * means a write is in progress (`torn`), while valid JSON that is not a list is a format this
 * version of Studio does not know (`unexpected`).
 */
export type RouteEntries =
  | { kind: "ok"; entries: unknown[] }
  | { kind: "missing" }
  | { kind: "torn" }
  | { kind: "unexpected" };

export function readRouteEntries(dir: string): RouteEntries {
  const raw = readText(dir, ROUTES_FILE);
  if (raw === null) return { kind: "missing" };
  if (raw.trim() === "") return { kind: "torn" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "torn" };
  }
  return Array.isArray(parsed) ? { kind: "ok", entries: parsed } : { kind: "unexpected" };
}

/** Live routes from `routes.json`. Invalid entries and apps whose process died are left out. */
export function readRoutes(dir: string, proxy: ProxyStatus): Route[] {
  const read = readRouteEntries(dir);
  return read.kind === "ok" ? routesFromEntries(read.entries, proxy) : [];
}

/** The routes in a parsed `routes.json`, without invalid entries and apps whose process died. */
export function routesFromEntries(entries: readonly unknown[], proxy: ProxyStatus): Route[] {
  return entries
    .flatMap((entry) => {
      const route = toRoute(entry, proxy);
      return route ? [route] : [];
    })
    .filter((route) => route.pid === null || isProcessAlive(route.pid))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** For the doctor: whether `routes.json` reads, and how many of its entries Studio cannot use. */
export type RoutesFileHealth = {
  state: RouteEntries["kind"];
  entries: number;
  /** Entries without a hostname, port and pid Studio understands; they are not shown. */
  unreadable: number;
};

export function inspectRoutesFile(dir: string): RoutesFileHealth {
  const read = readRouteEntries(dir);
  if (read.kind !== "ok") return { state: read.kind, entries: 0, unreadable: 0 };
  const proxy: ProxyStatus = { running: false, port: null, https: false, tlds: [DEFAULT_TLD] };
  const unreadable = read.entries.filter((entry) => toRoute(entry, proxy) === null).length;
  return { state: "ok", entries: read.entries.length, unreadable };
}

/** Signal 0 checks existence without touching the process; EPERM means it exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function toRoute(entry: unknown, proxy: ProxyStatus): Route | null {
  if (typeof entry !== "object" || entry === null) return null;
  const fields = entry as Record<string, unknown>;
  const { hostname, pid } = fields;
  const port = typeof fields.port === "number" ? toPort(fields.port) : null;
  if (typeof hostname !== "string" || hostname === "" || port === null) return null;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 0) return null;
  const registeredAt = fields.registeredAt;
  return {
    hostname,
    name: nameFromHostname(hostname, proxy.tlds),
    port,
    kind: pid === 0 ? "alias" : "app",
    pid: pid === 0 ? null : pid,
    registeredAt:
      typeof registeredAt === "number" && Number.isFinite(registeredAt) ? registeredAt : null,
    url: routeUrl(hostname, proxy),
    tunnels: toTunnels(fields),
  };
}

function toTunnels(fields: Record<string, unknown>): Tunnel[] {
  return TUNNEL_FIELDS.flatMap(([provider, field]) => {
    const url = fields[field];
    return typeof url === "string" && url !== "" ? [{ provider, url }] : [];
  });
}

/** `proxy.tlds` holds one TLD per line, comma separated, or a JSON array. */
function readTlds(dir: string): string[] {
  const raw = readText(dir, TLDS_FILE)?.trim();
  if (raw) {
    let values: unknown[] = [];
    try {
      const parsed: unknown = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[\r\n,]+/);
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      values = [];
    }
    const tlds = values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== "");
    if (tlds.length > 0) return [...new Set(tlds)];
  }
  const legacy = readText(dir, TLD_FILE)?.trim().toLowerCase();
  return [legacy || DEFAULT_TLD];
}

function toPort(value: number): number | null {
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

function readText(dir: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, file), "utf8");
  } catch {
    return null;
  }
}
