import type { ServerResponse } from "node:http";
import { SNAPSHOT_EVENT, type Snapshot } from "../../../core/api/contract.ts";

/** Where the full snapshot comes from: the Studio runtime, or anything shaped like it. */
export interface SnapshotSource {
  readSnapshot(): Promise<Snapshot>;
  /** Calls `onChange` after anything in the snapshot changes. Returns an unsubscribe. */
  watch(onChange: () => void): () => void;
}

/** Comment lines keep proxies and browsers from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

/** Server-sent events: every client gets the snapshot on connect and after each change. */
export class SnapshotEvents {
  readonly #source: SnapshotSource;
  readonly #clients = new Set<ServerResponse>();
  #stopWatching: (() => void) | undefined;
  #heartbeat: NodeJS.Timeout | undefined;

  constructor(source: SnapshotSource) {
    this.#source = source;
  }

  async connect(res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.write(format(await this.#source.readSnapshot()));
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
    this.#stopWatching = this.#source.watch(() => void this.#broadcast());
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
    const message = format(await this.#source.readSnapshot());
    for (const client of this.#clients) client.write(message);
  }
}

function format(snapshot: Snapshot): string {
  return `event: ${SNAPSHOT_EVENT}\ndata: ${JSON.stringify(snapshot)}\n\n`;
}
