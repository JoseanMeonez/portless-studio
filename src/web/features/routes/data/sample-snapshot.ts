import type { Snapshot } from "../../../../core/api/contract.ts";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import {
  healthFromProbe,
  type ItemProject,
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
  /** Project of the listening process; aliases to databases have none. */
  project?: ItemProject;
  /** How long the listening process has run; absent when the system does not say. */
  runningFor?: number;
};

const ACME = "acme-monorepo";
const AVE = "shop-admin";

// Where each checkout lives on the fake machine: the main one and two linked worktrees.
const ACME_MAIN: ItemProject = {
  name: ACME,
  worktree: null,
  branch: "main",
  path: "/home/dev/code/acme",
};
const ACME_RESEARCH: ItemProject = {
  name: ACME,
  worktree: "research",
  branch: "feat/ACME-42-search",
  path: "/home/dev/code/acme-research",
};
const ACME_FALCON: ItemProject = {
  name: ACME,
  worktree: "falcon",
  branch: "fix/dark-mode",
  path: "/home/dev/code/acme-falcon",
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
    runningFor: 2 * HOUR + 14 * MINUTE,
    project: ACME_MAIN,
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
    runningFor: 41 * MINUTE,
    project: ACME_MAIN,
  },
  {
    name: "docs",
    port: 3001,
    kind: "app",
    pid: 51_002,
    listenerPid: 51_009,
    answer: { status: 500, latencyMs: 31 },
    upFor: 26 * MINUTE,
    runningFor: 26 * MINUTE,
    project: ACME_RESEARCH,
  },
  {
    name: "storybook",
    port: 6006,
    kind: "app",
    pid: 50_117,
    listenerPid: 50_121,
    answer: { status: 200, latencyMs: 8 },
    upFor: 3 * 24 * HOUR + 4 * HOUR,
    runningFor: 5 * HOUR + 2 * MINUTE,
    project: ACME_FALCON,
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
    project: {
      name: AVE,
      worktree: "otter",
      branch: "feat/SHOP-7-orders",
      path: "/home/dev/code/shop-admin/otter",
    },
  },
  {
    port: 4321,
    pid: 60_912,
    processName: "node",
    cwd: "/home/dev/code/acme-falcon/apps/blog",
    suggestedName: "blog.acme",
    project: ACME_FALCON,
  },
  {
    port: 5173,
    pid: 60_877,
    processName: "node",
    cwd: "/home/dev/code/acme/apps/app",
    suggestedName: "app.acme",
    project: ACME_MAIN,
  },
  { port: 8000, pid: 62_003, processName: "python3", cwd: null, suggestedName: null },
  {
    port: 8090,
    pid: null,
    processName: "docker",
    cwd: null,
    suggestedName: "worker.acme",
    project: { name: ACME, worktree: null },
    container: { name: "acme-worker-1", image: "acme/worker:dev", composeProject: ACME },
  },
];

/** How long each sample detected server has run, by port; the others do not say. */
const DETECTED_RUNNING_FOR: Readonly<Record<number, number>> = {
  4209: 47 * MINUTE,
  4321: 3 * HOUR + 5 * MINUTE,
  5173: 12 * MINUTE,
};

/** A server the `?demo` mode starts a little after loading, so auto mode has something to name. */
export const SAMPLE_LATE_SERVER: DetectedPort = {
  port: 8787,
  pid: 63_150,
  processName: "workerd",
  cwd: "/home/dev/code/acme-research/apps/edge",
  suggestedName: "edge.acme",
  project: ACME_RESEARCH,
};

/**
 * Realistic routes for the `?demo` mode, as if portless had been running for a while.
 * `portlessInstalled: false` shows the install flow instead.
 */
export function createSampleSnapshot(now: number, portlessInstalled = true): Snapshot {
  // Studio's own default: HTTP on 1355, which needs no sudo.
  const proxy: ProxyStatus = { running: true, port: 1355, https: false, tlds: ["localhost"] };
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
      ...(sample.runningFor === undefined ? {} : { startedAt: now - sample.runningFor }),
      ...(sample.answer === undefined ? {} : { health: healthFromProbe(sample.answer, now) }),
      project: sample.project ?? null,
    };
  });
  const portless = portlessInstalled
    ? { installed: true, version: DEMO_PORTLESS_VERSION }
    : { installed: false, version: null };
  const detected = SAMPLE_DETECTED.map((item) => {
    const runningFor = DETECTED_RUNNING_FOR[item.port];
    return runningFor === undefined ? item : { ...item, startedAt: now - runningFor };
  });
  return { proxy, portless, routes, detected, autoName: false, readAt: now };
}
