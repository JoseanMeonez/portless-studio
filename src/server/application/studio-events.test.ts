import type { RouteHealth } from "../../core/routes/route.ts";
import { EventLog, eventsBetween, type Observation } from "./studio-events.ts";

const up: RouteHealth = { state: "up", status: 200, latencyMs: 3, checkedAt: 1 };
const down: RouteHealth = { state: "down", checkedAt: 2 };

function observation(change: Partial<Observation> = {}): Observation {
  return { routes: [], detected: [], proxy: { running: true, port: 1355 }, ...change };
}

const route = (name: string, port: number, health?: RouteHealth) => ({
  name,
  port,
  url: `http://${name}.localhost:1355`,
  ...(health ? { health } : {}),
});

describe("eventsBetween", () => {
  it("reports a new dev server with its suggested name and points at its port", () => {
    const events = eventsBetween(
      observation(),
      observation({ detected: [{ port: 5173, processName: "node", suggestedName: "app" }] }),
    );
    expect(events).toEqual([
      {
        kind: "detected",
        title: "New server on port 5173",
        body: "node, suggested name app",
        target: { port: 5173 },
      },
    ]);
  });

  it("reports a new name and a removed one", () => {
    const named = eventsBetween(observation(), observation({ routes: [route("app", 5173)] }));
    expect(named).toEqual([
      {
        kind: "named",
        title: "Named app",
        body: "Port 5173 opens at http://app.localhost:1355",
        target: { route: "app", port: 5173 },
      },
    ]);
    const removed = eventsBetween(observation({ routes: [route("app", 5173)] }), observation());
    expect(removed).toEqual([
      {
        kind: "removed",
        title: "Removed app",
        body: "Port 5173 has no name now.",
        target: { port: 5173 },
      },
    ]);
  });

  it("reports a rename as one named event", () => {
    const events = eventsBetween(
      observation({ routes: [route("app", 5173)] }),
      observation({ routes: [route("web", 5173)] }),
    );
    expect(events).toEqual([
      {
        kind: "named",
        title: "Named web",
        body: "Renamed from app. Port 5173 opens at http://web.localhost:1355",
        target: { route: "web", port: 5173 },
      },
    ]);
  });

  it("does not report the detected port that got its name in the same change", () => {
    const events = eventsBetween(observation(), observation({ routes: [route("app", 5173)] }));
    expect(events.map((event) => event.kind)).toEqual(["named"]);
  });

  it("reports a port that lost its name as removed, not as a new server", () => {
    const events = eventsBetween(
      observation({ routes: [route("app", 5173)] }),
      observation({ detected: [{ port: 5173, processName: "node", suggestedName: "app" }] }),
    );
    expect(events.map((event) => event.kind)).toEqual(["removed"]);
  });

  it("reports a route going down and coming back, not its first probe", () => {
    expect(
      eventsBetween(
        observation({ routes: [route("app", 5173)] }),
        observation({ routes: [route("app", 5173, down)] }),
      ),
    ).toEqual([]);
    expect(
      eventsBetween(
        observation({ routes: [route("app", 5173, up)] }),
        observation({ routes: [route("app", 5173, down)] }),
      ),
    ).toEqual([
      {
        kind: "down",
        title: "app stopped answering",
        body: "Nothing answers on port 5173.",
        target: { route: "app", port: 5173 },
      },
    ]);
    expect(
      eventsBetween(
        observation({ routes: [route("app", 5173, down)] }),
        observation({ routes: [route("app", 5173, up)] }),
      ),
    ).toEqual([
      {
        kind: "up",
        title: "app is back",
        body: "Port 5173 answers again.",
        target: { route: "app", port: 5173 },
      },
    ]);
  });

  it("reports the proxy starting and stopping", () => {
    const stopped = observation({ proxy: { running: false, port: 1355 } });
    expect(eventsBetween(observation(), stopped)).toEqual([
      {
        kind: "proxy",
        title: "Proxy stopped",
        body: "Names do not open until it starts again.",
        target: {},
      },
    ]);
    expect(eventsBetween(stopped, observation())).toEqual([
      { kind: "proxy", title: "Proxy started", body: "Names open on port 1355.", target: {} },
    ]);
  });
});

describe("EventLog", () => {
  it("stamps events with a unique id and time, and tells subscribers", () => {
    let clock = 100;
    const log = new EventLog({ now: () => clock, max: 3 });
    const heard: string[] = [];
    const stop = log.subscribe((event) => heard.push(event.id));

    const [first] = log.add([{ kind: "proxy", title: "a", body: "", target: {} }]);
    clock = 200;
    const [second] = log.add([{ kind: "proxy", title: "b", body: "", target: {} }]);
    expect(first?.at).toBe(100);
    expect(second?.at).toBe(200);
    expect(first?.id).not.toBe(second?.id);
    expect(heard).toEqual([first?.id, second?.id]);

    stop();
    log.add([{ kind: "proxy", title: "c", body: "", target: {} }]);
    expect(heard).toHaveLength(2);
  });

  it("keeps only the most recent events", () => {
    const log = new EventLog({ now: () => 1, max: 2 });
    for (const title of ["a", "b", "c"]) log.add([{ kind: "proxy", title, body: "", target: {} }]);
    expect(log.recent().map((event) => event.title)).toEqual(["b", "c"]);
  });
});
