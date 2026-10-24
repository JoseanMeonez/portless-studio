import type { Snapshot } from "../../../../core/api/contract.ts";
import {
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
};

const SAMPLE_ROUTES: SampleRoute[] = [
  {
    name: "web.acme",
    port: 3000,
    kind: "app",
    pid: 48_213,
    upFor: 2 * HOUR + 14 * MINUTE,
    tunnels: [
      { provider: "tailscale", url: "https://web-acme.tail2f9c.ts.net" },
      { provider: "ngrok", url: "https://4f1c-web-acme.ngrok-free.app" },
    ],
  },
  { name: "api.acme", port: 4000, kind: "app", pid: 48_240, upFor: 2 * HOUR + 13 * MINUTE },
  { name: "docs", port: 5173, kind: "app", pid: 51_002, upFor: 26 * MINUTE },
  {
    name: "storybook",
    port: 6006,
    kind: "app",
    pid: 50_117,
    upFor: 3 * 24 * HOUR + 4 * HOUR,
    tunnels: [{ provider: "cloudflare", url: "https://storybook-demo.trycloudflare.com" }],
  },
  { name: "db", port: 5432, kind: "alias", upFor: 9 * 24 * HOUR },
  { name: "redis", port: 6379, kind: "alias", upFor: null },
];

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
    };
  });
  const portless = portlessInstalled
    ? { installed: true, version: DEMO_PORTLESS_VERSION }
    : { installed: false, version: null };
  return { proxy, portless, routes, readAt: now };
}
