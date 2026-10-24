import type { StudioEvent } from "../../core/api/contract.ts";
import type { DetectedPort } from "../../core/ports/detected-port.ts";
import type { ProxyStatus, Route } from "../../core/routes/route.ts";

/** The parts of a snapshot that notifications are about. */
export type Observation = {
  routes: ReadonlyArray<Pick<Route, "name" | "port" | "url" | "health">>;
  detected: ReadonlyArray<Pick<DetectedPort, "port" | "processName" | "suggestedName">>;
  proxy: Pick<ProxyStatus, "running" | "port">;
};

/** An event before the log gives it an id and a time. */
export type EventDraft = Omit<StudioEvent, "id" | "at">;

/** What changed between two observations, as notifications. A pure function. */
export function eventsBetween(previous: Observation, next: Observation): EventDraft[] {
  const events: EventDraft[] = [];
  const before = new Map(previous.routes.map((route) => [route.name, route]));
  const after = new Map(next.routes.map((route) => [route.name, route]));
  const added = next.routes.filter((route) => !before.has(route.name));
  const gone = previous.routes.filter((route) => !after.has(route.name));
  const renamedFrom = new Map<string, string>();
  for (const route of added) {
    const old = gone.find((item) => item.port === route.port && !renamedFrom.has(item.name));
    if (old) renamedFrom.set(old.name, route.name);
  }

  // A port that just lost its name is reported as removed, not as a new server.
  const knownPorts = new Set([
    ...previous.detected.map((item) => item.port),
    ...previous.routes.map((route) => route.port),
    ...next.routes.map((route) => route.port),
  ]);
  for (const item of next.detected) {
    if (knownPorts.has(item.port)) continue;
    events.push({
      kind: "detected",
      title: `New server on port ${item.port}`,
      body: item.suggestedName
        ? `${item.processName}, suggested name ${item.suggestedName}`
        : `${item.processName}, no name suggested`,
      target: { port: item.port },
    });
  }

  for (const route of added) {
    const old = [...renamedFrom].find(([, name]) => name === route.name)?.[0];
    const opens = `Port ${route.port} opens at ${route.url}`;
    events.push({
      kind: "named",
      title: `Named ${route.name}`,
      body: old ? `Renamed from ${old}. ${opens}` : opens,
      target: { route: route.name, port: route.port },
    });
  }

  for (const route of gone) {
    if (renamedFrom.has(route.name)) continue;
    events.push({
      kind: "removed",
      title: `Removed ${route.name}`,
      body: `Port ${route.port} has no name now.`,
      target: { port: route.port },
    });
  }

  for (const route of next.routes) {
    const was = before.get(route.name)?.health?.state;
    const now = route.health?.state;
    if (was === undefined || now === undefined) continue;
    const target = { route: route.name, port: route.port };
    if (was !== "down" && now === "down") {
      events.push({
        kind: "down",
        title: `${route.name} stopped answering`,
        body: `Nothing answers on port ${route.port}.`,
        target,
      });
    } else if (was === "down" && now !== "down") {
      events.push({
        kind: "up",
        title: `${route.name} is back`,
        body: `Port ${route.port} answers again.`,
        target,
      });
    }
  }

  if (previous.proxy.running !== next.proxy.running) {
    events.push(
      next.proxy.running
        ? {
            kind: "proxy",
            title: "Proxy started",
            body: `Names open on port ${next.proxy.port}.`,
            target: {},
          }
        : {
            kind: "proxy",
            title: "Proxy stopped",
            body: "Names do not open until it starts again.",
            target: {},
          },
    );
  }
  return events;
}

export type EventLogOptions = {
  now?: () => number;
  /** How many events a page that connects later still gets. */
  max?: number;
};

/** The last events of this run, kept in memory, and who wants to hear about new ones. */
export class EventLog {
  readonly #now: () => number;
  readonly #max: number;
  // Ids only need to be unique while this server runs; the start time keeps two runs apart.
  readonly #run: string;
  #sequence = 0;
  #events: StudioEvent[] = [];
  readonly #listeners = new Set<(event: StudioEvent) => void>();

  constructor(options: EventLogOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#max = options.max ?? 50;
    this.#run = this.#now().toString(36);
  }

  add(drafts: readonly EventDraft[]): StudioEvent[] {
    const events = drafts.map((draft) => {
      this.#sequence += 1;
      return { ...draft, id: `${this.#run}-${this.#sequence}`, at: this.#now() };
    });
    if (events.length === 0) return events;
    this.#events = [...this.#events, ...events].slice(-this.#max);
    for (const event of events) for (const listener of this.#listeners) listener(event);
    return events;
  }

  /** Oldest first. */
  recent(): StudioEvent[] {
    return [...this.#events];
  }

  subscribe(listener: (event: StudioEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
