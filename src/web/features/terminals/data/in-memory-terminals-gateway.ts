import type { ApiError, CreateTerminalRequest } from "../../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../../core/result.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import type { TerminalStreamHandlers, TerminalsGateway } from "./terminals-gateway.ts";

type Entry = { info: TerminalInfo; output: string; watchers: Set<TerminalStreamHandlers> };

/**
 * Terminals kept in memory: commands do not run, input is echoed back. Tests drive it, and
 * `?demo` uses it to show the panel without a server.
 */
export class InMemoryTerminalsGateway implements TerminalsGateway {
  readonly #entries = new Map<string, Entry>();
  readonly #listListeners = new Set<(terminals: TerminalInfo[]) => void>();
  readonly #now: () => number;
  #nextId = 1;
  /** Everything typed into each terminal, in order; tests read it. */
  readonly inputs: { id: string; text: string }[] = [];
  /** Requests `create` received; tests read them. */
  readonly created: CreateTerminalRequest[] = [];

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  watchList(listener: (terminals: TerminalInfo[]) => void): () => void {
    this.#listListeners.add(listener);
    listener(this.#list());
    return () => this.#listListeners.delete(listener);
  }

  async create(request: CreateTerminalRequest): Promise<Result<TerminalInfo, ApiError>> {
    this.created.push(request);
    const cwd = request.cwd ?? (request.project ? `/demo/${request.project}` : "");
    if (cwd === "") return err({ error: "invalid_request", message: "Give a folder." });
    const id = `t${this.#nextId++}`;
    const command = request.command?.trim() ?? "";
    const info: TerminalInfo = {
      id,
      title: request.title ?? (command || "shell"),
      cwd,
      command,
      project: request.project ?? cwd.split("/").filter(Boolean).at(-1) ?? null,
      status: "running",
      exitCode: null,
      startedAt: this.#now(),
      endedAt: null,
      pid: 4000 + this.#nextId,
      mode: "pty",
      cols: request.cols ?? 120,
      rows: request.rows ?? 30,
      nextSeq: 0,
      naming: null,
    };
    this.#entries.set(id, { info, output: "", watchers: new Set() });
    this.write(id, command ? `$ ${command}\r\n` : "$ ");
    this.#publishList();
    return ok({ ...info });
  }

  async input(id: string, text: string): Promise<Result<null, ApiError>> {
    const entry = this.#entries.get(id);
    if (!entry) return notFound(id);
    if (entry.info.status !== "running") {
      return err({ error: "terminal_not_running", message: "The command already ended." });
    }
    this.inputs.push({ id, text });
    this.write(id, text.replaceAll("\r", "\r\n"));
    return ok(null);
  }

  async stop(id: string): Promise<Result<TerminalInfo, ApiError>> {
    const entry = this.#entries.get(id);
    if (!entry) return notFound(id);
    this.finish(id, 130);
    return ok({ ...entry.info });
  }

  async restart(id: string): Promise<Result<TerminalInfo, ApiError>> {
    const entry = this.#entries.get(id);
    if (!entry) return notFound(id);
    entry.info = { ...entry.info, status: "running", exitCode: null, endedAt: null };
    this.write(id, `\r\n[Studio] restarted: ${entry.info.command || "shell"}\r\n`);
    this.#publishStatus(entry);
    return ok({ ...entry.info });
  }

  async remove(id: string): Promise<Result<null, ApiError>> {
    if (!this.#entries.delete(id)) return notFound(id);
    this.#publishList();
    return ok(null);
  }

  async output(id: string): Promise<Result<string, ApiError>> {
    const entry = this.#entries.get(id);
    return entry ? ok(entry.output) : notFound(id);
  }

  stream(id: string, from: number, handlers: TerminalStreamHandlers): () => void {
    const entry = this.#entries.get(id);
    if (!entry) return () => {};
    const backlog = entry.output.slice(from);
    if (backlog) handlers.onOutput({ seq: Math.min(from, entry.output.length), data: backlog });
    handlers.onStatus({ ...entry.info });
    entry.watchers.add(handlers);
    return () => entry.watchers.delete(handlers);
  }

  /** Adds output, as a running command would. */
  write(id: string, text: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    const seq = entry.output.length;
    entry.output += text;
    entry.info = { ...entry.info, nextSeq: entry.output.length };
    for (const watcher of entry.watchers) watcher.onOutput({ seq, data: text });
  }

  /** Ends the command with this exit code. */
  finish(id: string, exitCode: number | null): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.info = { ...entry.info, status: "exited", exitCode, endedAt: this.#now() };
    this.#publishStatus(entry);
  }

  #publishStatus(entry: Entry): void {
    for (const watcher of entry.watchers) watcher.onStatus({ ...entry.info });
    this.#publishList();
  }

  #publishList(): void {
    const list = this.#list();
    for (const listener of this.#listListeners) listener(list);
  }

  #list(): TerminalInfo[] {
    return [...this.#entries.values()].map((entry) => ({ ...entry.info }));
  }
}

function notFound(id: string): Result<never, ApiError> {
  return err({ error: "not_found", message: `No terminal has the id "${id}".` });
}
