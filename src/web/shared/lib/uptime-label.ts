import type { Route } from "../../../core/routes/route.ts";
import { formatUptime } from "./format-uptime.ts";

/** What the uptime column shows for a row, and the tooltip that explains it. */
export type UptimeLabel = {
  /** `up 2h 13m`, `named 3d`, `down`, or empty when nothing is known. */
  text: string;
  title: string;
  /** `up` from the process start, `named` from when the name was given, `down`, or `unknown`. */
  state: "up" | "named" | "down" | "unknown";
};

type UptimeRoute = Pick<
  Route,
  "kind" | "port" | "registeredAt" | "listenerPid" | "startedAt" | "health"
>;

/** Local date and time, like the browser writes it. Tests pass a fixed one. */
export type FormatTime = (epochMs: number) => string;

const localTime: FormatTime = (epochMs) => new Date(epochMs).toLocaleString();

/**
 * How long a route's server has been running, from when its process started. A route whose
 * port does not answer says `down` instead of a stale time. When the process runs but its start
 * time cannot be read, the time since the name was given is shown, labelled `named`.
 */
export function routeUptime(
  route: UptimeRoute,
  now: number,
  formatTime: FormatTime = localTime,
): UptimeLabel {
  const named =
    route.kind === "alias" && route.registeredAt !== null
      ? `Named ${ago(route.registeredAt, now)}`
      : null;
  const withNamed = (title: string) => (named ? `${title}\n${named}` : title);

  if (route.startedAt !== undefined) {
    return {
      text: `up ${short(route.startedAt, now)}`,
      title: withNamed(`Running since ${formatTime(route.startedAt)}`),
      state: "up",
    };
  }
  const state = route.health?.state;
  const live = route.listenerPid !== undefined || state === "up" || state === "error";
  if (live) {
    const unknown = "Running; its start time is unknown";
    if (route.registeredAt === null) return { text: "", title: unknown, state: "unknown" };
    return {
      text: `named ${short(route.registeredAt, now)}`,
      title: `${unknown}\nNamed ${ago(route.registeredAt, now)}`,
      state: "named",
    };
  }
  if (state === "down") {
    return {
      text: "down",
      title: withNamed(`Nothing answers on :${route.port}`),
      state: "down",
    };
  }
  return { text: "", title: named ?? "", state: "unknown" };
}

/** The uptime of a detected port's process; empty when its start time is unknown. */
export function processUptime(
  startedAt: number | undefined,
  now: number,
  formatTime: FormatTime = localTime,
): UptimeLabel {
  if (startedAt === undefined) return { text: "", title: "", state: "unknown" };
  return {
    text: `up ${short(startedAt, now)}`,
    title: `Running since ${formatTime(startedAt)}`,
    state: "up",
  };
}

function short(since: number, now: number): string {
  const text = formatUptime(since, now) ?? "";
  return text === "just now" ? "<1m" : text;
}

function ago(since: number, now: number): string {
  const text = formatUptime(since, now) ?? "";
  return text === "just now" ? "just now" : `${text} ago`;
}
