import type { DetectedPort } from "./detected-port.ts";

/** An inclusive range of port numbers, e.g. the ports the system hands out for port 0. */
export type PortRange = { first: number; last: number };

/**
 * Why a detected port sits under "Other ports" instead of the main list: the process of a server
 * that already has a name also listens on it (`sibling`), it is a Node, V8 or Chrome debugger
 * (`debugger`), or the system picked it because the program asked for any free port
 * (`ephemeral`).
 */
export type OtherPortReason = "sibling" | "debugger" | "ephemeral";

/** A detected port kept out of the main list; auto mode never names it. */
export type OtherPort = DetectedPort & {
  reason: OtherPortReason;
  /** The named route this port belongs to, when one was found. */
  routeName?: string;
};

/** Where the operating systems hand out ports for port 0 when nobody changed the setting. */
export const DEFAULT_EPHEMERAL_RANGES: Readonly<Record<"linux" | "darwin" | "win32", PortRange>> = {
  linux: { first: 32768, last: 60999 },
  darwin: { first: 49152, last: 65535 },
  win32: { first: 49152, last: 65535 },
};

/** Node (`--inspect`) and Chrome (`--remote-debugging-port`) debugger defaults. */
export const DEBUGGER_PORTS: readonly number[] = [9229, 9222];

/** What a GET of `/json/version` on a port said about it. */
export type DebuggerProbe = "debugger" | "other" | "unknown";

/** True for the `/json/version` answer of a V8 inspector or a Chrome DevTools endpoint. */
export function isDebuggerVersionInfo(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return ["V8-Version", "Browser", "Protocol-Version"].some((key) => Object.hasOwn(value, key));
}

export function isInRange(port: number, range: PortRange | null): boolean {
  return range !== null && port >= range.first && port <= range.last;
}

/** A route whose port a process listens on right now. */
export type ListeningRoute = { name: string; port: number; pid: number | null; cwd: string | null };

export type ArrangeInput = {
  detected: readonly DetectedPort[];
  /** What the debugger probe said per port; a missing port counts as `unknown`. */
  debuggers: ReadonlyMap<number, DebuggerProbe>;
  /** The system's ephemeral range; null turns that rule off. */
  ephemeralRange: PortRange | null;
  /** `showEphemeralPorts` from the config: ephemeral ports stay in the main list. */
  showEphemeral: boolean;
  routes: readonly ListeningRoute[];
};

/**
 * Splits detected ports into the main list and "Other ports". A debugger, another port of the
 * process that serves a named route, and a port in the ephemeral range are helpers, not
 * servers a person opens. The rest is grouped per process: the lowest port outside the ephemeral
 * range is the row, the others are its `extraPorts`.
 */
export function arrangeDetected(input: ArrangeInput): {
  detected: DetectedPort[];
  otherPorts: OtherPort[];
} {
  const main: DetectedPort[] = [];
  const otherPorts: OtherPort[] = [];
  for (const item of input.detected) {
    const route = siblingRoute(item, input.routes);
    const reason = otherReason(item, route, input);
    if (reason === null) {
      main.push(item);
      continue;
    }
    otherPorts.push({ ...item, reason, ...(route === null ? {} : { routeName: route.name }) });
  }
  return {
    detected: groupByProcess(main, input.ephemeralRange),
    otherPorts: otherPorts.sort((a, b) => a.port - b.port),
  };
}

function otherReason(
  item: DetectedPort,
  route: ListeningRoute | null,
  input: ArrangeInput,
): OtherPortReason | null {
  const probe = input.debuggers.get(item.port) ?? "unknown";
  if (probe === "debugger" || (probe === "unknown" && DEBUGGER_PORTS.includes(item.port))) {
    return "debugger";
  }
  if (route !== null) return "sibling";
  // Docker picks a host port in this range for `-P`; people do open those.
  if (!item.container && !input.showEphemeral && isInRange(item.port, input.ephemeralRange)) {
    return "ephemeral";
  }
  return null;
}

/**
 * The named route whose process also listens on this port, like an HMR socket. Another process
 * in the same folder is a separate server (an app and its Storybook) and stays in the main list.
 */
function siblingRoute(
  item: DetectedPort,
  routes: readonly ListeningRoute[],
): ListeningRoute | null {
  if (item.pid === null) return null;
  return routes.find((route) => route.pid === item.pid) ?? null;
}

function groupByProcess(items: readonly DetectedPort[], range: PortRange | null): DetectedPort[] {
  const byPid = new Map<number, DetectedPort[]>();
  const rows: DetectedPort[] = [];
  for (const item of items) {
    if (item.pid === null) {
      rows.push(item);
      continue;
    }
    const group = byPid.get(item.pid);
    if (group) group.push(item);
    else byPid.set(item.pid, [item]);
  }
  for (const group of byPid.values()) {
    const sorted = [...group].sort((a, b) => a.port - b.port);
    const head = sorted.find((item) => !isInRange(item.port, range)) ?? sorted[0];
    if (head === undefined) continue;
    const extraPorts = sorted.filter((item) => item !== head).map((item) => item.port);
    rows.push(extraPorts.length === 0 ? head : { ...head, extraPorts });
  }
  return rows.sort((a, b) => a.port - b.port);
}
