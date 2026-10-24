import type { ServerResponse } from "node:http";
import {
  TERMINAL_OUTPUT_EVENT,
  TERMINAL_STATUS_EVENT,
  TERMINALS_EVENT,
  type TerminalsResponse,
} from "../../../core/api/contract.ts";
import type { Result } from "../../../core/result.ts";
import type { AppError } from "../../application/app-error.ts";
import type { TerminalManager } from "../../application/terminals.ts";

/** Comment lines keep proxies and browsers from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events for terminals: the list of terminals, and one terminal's output. Each open
 * stream is tracked so Studio can end them when it stops.
 */
export class TerminalStreams {
  readonly #terminals: TerminalManager;
  readonly #open = new Set<ServerResponse>();

  constructor(terminals: TerminalManager) {
    this.#terminals = terminals;
  }

  /** `terminals` with the whole list now and after every change. */
  list(res: ServerResponse): void {
    this.#begin(res);
    const send = () => {
      const body: TerminalsResponse = { terminals: this.#terminals.list() };
      write(res, TERMINALS_EVENT, body);
    };
    send();
    const stop = this.#terminals.watch(send);
    this.#track(res, stop);
  }

  /** The kept output from `from`, then `status`, then live output and status changes. */
  terminal(res: ServerResponse, id: string, from: number): Result<void, AppError> {
    const info = this.#terminals.get(id);
    if (!info) return { ok: false, error: { code: "not_found", message: `No terminal "${id}".` } };
    this.#begin(res);
    const subscribed = this.#terminals.subscribe(id, from, {
      onOutput: (chunk) => write(res, TERMINAL_OUTPUT_EVENT, chunk),
      onStatus: (status) => write(res, TERMINAL_STATUS_EVENT, status),
    });
    if (!subscribed.ok) {
      res.end();
      return subscribed;
    }
    // After the backlog, so a client that stops at `exited` has already got all the output.
    write(res, TERMINAL_STATUS_EVENT, this.#terminals.get(id) ?? info);
    this.#track(res, subscribed.value);
    return { ok: true, value: undefined };
  }

  close(): void {
    for (const res of this.#open) res.end();
    this.#open.clear();
  }

  #begin(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
  }

  #track(res: ServerResponse, stop: () => void): void {
    this.#open.add(res);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    res.on("close", () => {
      clearInterval(heartbeat);
      stop();
      this.#open.delete(res);
    });
  }
}

function write(res: ServerResponse, event: string, data: unknown): void {
  if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
