import type { ServerResponse } from "node:http";
import { SNAPSHOT_EVENT, type Snapshot } from "../../../core/api/contract.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import { listSnapshot } from "../../application/route-use-cases.ts";

/** Comment lines keep proxies and browsers from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

/** Server-sent events: every client gets the snapshot on connect and after each change. */
export class SnapshotEvents {
  readonly #registry: RouteRegistry;
  readonly #clients = new Set<ServerResponse>();
  #stopWatching: (() => void) | undefined;
  #heartbeat: NodeJS.Timeout | undefined;

  constructor(registry: RouteRegistry) {
    this.#registry = registry;
  }

  async connect(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(format(await listSnapshot(this.#registry)));
    if (res.destroyed) return;
    this.#clients.add(res);
    res.on("close", () => this.#disconnect(res));
    this.#start();
  }

  close(): void {
    for (const client of this.#clients) client.end();
    this.#clients.clear();
    this.#stop();
  }

  #start(): void {
    if (this.#stopWatching) return;
    this.#stopWatching = this.#registry.watch(() => void this.#broadcast());
    this.#heartbeat = setInterval(() => {
      for (const client of this.#clients) client.write(": ping\n\n");
    }, HEARTBEAT_MS);
  }

  #stop(): void {
    this.#stopWatching?.();
    this.#stopWatching = undefined;
    clearInterval(this.#heartbeat);
  }

  #disconnect(res: ServerResponse): void {
    this.#clients.delete(res);
    if (this.#clients.size === 0) this.#stop();
  }

  async #broadcast(): Promise<void> {
    const message = format(await listSnapshot(this.#registry));
    for (const client of this.#clients) client.write(message);
  }
}

function format(snapshot: Snapshot): string {
  return `event: ${SNAPSHOT_EVENT}\ndata: ${JSON.stringify(snapshot)}\n\n`;
}
