import type { Route } from "../../../core/routes/route.ts";
import { processUptime, routeUptime } from "./uptime-label.ts";

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);
const HOUR = 3_600_000;
const fixedTime = (epochMs: number) => new Date(epochMs).toISOString();

const base: Pick<Route, "kind" | "port" | "registeredAt" | "listenerPid" | "startedAt" | "health"> =
  { kind: "alias", port: 5173, registeredAt: NOW - 3 * 24 * HOUR };

describe("routeUptime", () => {
  it("counts from when the process started, not from when the name was given", () => {
    const label = routeUptime(
      { ...base, listenerPid: 42, startedAt: NOW - 2 * HOUR - 13 * 60_000 },
      NOW,
      fixedTime,
    );
    expect(label).toEqual({
      text: "up 2h 13m",
      title: `Running since ${fixedTime(NOW - 2 * HOUR - 13 * 60_000)}\nNamed 3d ago`,
      state: "up",
    });
  });

  it("does not add the name time to an app's tooltip", () => {
    const label = routeUptime(
      { ...base, kind: "app", listenerPid: 42, startedAt: NOW - 30_000 },
      NOW,
      fixedTime,
    );
    expect(label.text).toBe("up <1m");
    expect(label.title).toBe(`Running since ${fixedTime(NOW - 30_000)}`);
  });

  it("says down instead of a stale time when the port does not answer", () => {
    const label = routeUptime(
      { ...base, health: { state: "down", checkedAt: NOW } },
      NOW,
      fixedTime,
    );
    expect(label).toEqual({
      text: "down",
      title: "Nothing answers on :5173\nNamed 3d ago",
      state: "down",
    });
  });

  it("falls back to the name time, labelled named, when a live process has no start time", () => {
    const label = routeUptime({ ...base, listenerPid: 42 }, NOW, fixedTime);
    expect(label).toEqual({
      text: "named 3d",
      title: "Running; its start time is unknown\nNamed 3d ago",
      state: "named",
    });
    const answering = routeUptime(
      { ...base, health: { state: "up", status: 200, checkedAt: NOW } },
      NOW,
    );
    expect(answering.text).toBe("named 3d");
  });

  it("shows nothing when neither the process nor the port is known", () => {
    expect(routeUptime({ ...base, registeredAt: null }, NOW).text).toBe("");
    expect(routeUptime(base, NOW).state).toBe("unknown");
  });
});

describe("processUptime", () => {
  it("shows how long a detected port's process has run", () => {
    expect(processUptime(NOW - 5 * HOUR, NOW, fixedTime)).toEqual({
      text: "up 5h",
      title: `Running since ${fixedTime(NOW - 5 * HOUR)}`,
      state: "up",
    });
    expect(processUptime(undefined, NOW).text).toBe("");
  });
});
