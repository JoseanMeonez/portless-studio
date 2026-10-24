import type { Snapshot } from "../../../../core/api/contract.ts";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import {
  healthFromProbe,
  type ProxyStatus,
  type Route,
  type RouteKind,
  routeUrl,
  type Tunnel,
} from "../../../../core/routes/route.ts";
import { DEMO_PORTLESS_VERSION } from "./in-memory-routes-gateway.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type SampleRoute = {
  name: string;
  port: number;
  kind: RouteKind;
  pid?: number;
  upFor: number | null;
  tunnels?: Tunnel[];
  /** The dev server listening on the port, which the row can stop. */
  listenerPid?: number;
  /** Last probe: status and latency, or null when the port does not answer. */
  answer?: { status: number; latencyMs: number } | null;
};

const SAMPLE_ROUTES: SampleRoute[] = [
  {
    name: "web.acme",
    port: 3000,
    kind: "app",
    pid: 48_213,
    listenerPid: 48_219,
    answer: { status: 200, latencyMs: 12 },
    upFor: 2 * HOUR + 14 * MINUTE,
    tunnels: [
      { provider: "tailscale", url: "https://web-acme.tail2f9c.ts.net" },
      { provider: "ngrok", url: "https://4f1c-web-acme.ngrok-free.app" },
    ],
  },
  {
    name: "api.acme",
    port: 4000,
    kind: "app",
    pid: 48_240,
    listenerPid: 48_246,
    answer: { status: 200, latencyMs: 4 },
    upFor: 2 * HOUR + 13 * MINUTE,
  },
  {
    name: "docs",
    port: 3001,
    kind: "app",
    pid: 51_002,
    listenerPid: 51_009,
    answer: { status: 500, latencyMs: 31 },
    upFor: 26 * MINUTE,
  },
  {
    name: "storybook",
    port: 6006,
    kind: "app",
    pid: 50_117,
    listenerPid: 50_121,
    answer: { status: 200, latencyMs: 8 },
    upFor: 3 * 24 * HOUR + 4 * HOUR,
    tunnels: [{ provider: "cloudflare", url: "https://storybook-demo.trycloudflare.com" }],
  },
  { name: "db", port: 5432, kind: "alias", upFor: 9 * 24 * HOUR, answer: null },
  { name: "redis", port: 6379, kind: "alias", upFor: null, answer: null },
];

/** Dev servers running without a portless name, as the server's port scan finds them. */
export const SAMPLE_DETECTED: readonly DetectedPort[] = [
  {
    port: 4209,
    pid: 61_480,
    processName: "ng",
    cwd: "/home/dev/code/shop-admin/otter",
    suggestedName: "otter.shop-admin",
  },
  {
    port: 4321,
    pid: 60_912,
    processName: "node",
    cwd: "/home/dev/code/acme/apps/blog",
    suggestedName: "blog.acme",
  },
  {
    port: 5173,
    pid: 60_877,
    processName: "node",
    cwd: "/home/dev/code/acme/apps/app",
    suggestedName: "app.acme",
  },
  { port: 8000, pid: 62_003, processName: "python3", cwd: null, suggestedName: null },
];

/** A server the `?demo` mode starts a little after loading, so auto mode has something to name. */
export const SAMPLE_LATE_SERVER: DetectedPort = {
  port: 8787,
  pid: 63_150,
  processName: "workerd",
  cwd: "/home/dev/code/acme/apps/edge",
  suggestedName: "edge.acme",
};

/**
 * Realistic routes for the `?demo` mode, as if portless had been running for a while.
 * `portlessInstalled: false` shows the install flow instead.
 */
export function createSampleSnapshot(now: number, portlessInstalled = true): Snapshot {
  const proxy: ProxyStatus = { running: true, port: 443, https: true, tlds: ["localhost"] };
  const routes = SAMPLE_ROUTES.map((sample): Route => {
    const hostname = `${sample.name}.${proxy.tlds[0]}`;
    return {
      hostname,
      name: sample.name,
      port: sample.port,
      kind: sample.kind,
      pid: sample.pid ?? null,
      registeredAt: sample.upFor === null ? null : now - sample.upFor,
      url: routeUrl(hostname, proxy),
      tunnels: sample.tunnels ?? [],
      ...(sample.listenerPid === undefined ? {} : { listenerPid: sample.listenerPid }),
      ...(sample.answer === undefined ? {} : { health: healthFromProbe(sample.answer, now) }),
    };
  });
  const portless = portlessInstalled
    ? { installed: true, version: DEMO_PORTLESS_VERSION }
    : { installed: false, version: null };
  return { proxy, portless, routes, detected: [...SAMPLE_DETECTED], autoName: false, readAt: now };
}
