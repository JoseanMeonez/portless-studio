import {
  API_PATHS,
  type ApiError,
  type CreateTerminalRequest,
  type Session,
  TERMINAL_OUTPUT_EVENT,
  TERMINAL_STATUS_EVENT,
  TERMINALS_EVENT,
  type TerminalOutputChunk,
  type TerminalOutputResponse,
  type TerminalsResponse,
  TOKEN_HEADER,
  TOKEN_PARAM,
} from "../../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../../core/result.ts";
import type { TerminalInfo } from "../../../../core/terminals/terminal.ts";
import type { TerminalStreamHandlers, TerminalsGateway } from "./terminals-gateway.ts";

type HttpTerminalsGatewayOptions = {
  /** Origin of the API. Empty means the page's own origin. */
  baseUrl?: string;
  fetch?: typeof fetch;
  createEventSource?: (url: string) => EventSource;
  /** Wait before reconnecting a dropped stream. */
  reconnectMs?: number;
};

const unreachable: ApiError = {
  error: "internal",
  message: "Could not reach the Portless Studio server. Is it still running?",
};

/**
 * `TerminalsGateway` over Studio's HTTP API. Every terminal endpoint needs the session token,
 * reads too; event streams carry it in the query because EventSource sends no headers.
 */
export class HttpTerminalsGateway implements TerminalsGateway {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #createEventSource: (url: string) => EventSource;
  readonly #reconnectMs: number;
  #token: Promise<Result<string, ApiError>> | null = null;

  constructor(options: HttpTerminalsGatewayOptions = {}) {
    this.#baseUrl = options.baseUrl ?? "";
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#createEventSource = options.createEventSource ?? ((url) => new EventSource(url));
    this.#reconnectMs = options.reconnectMs ?? 2_000;
  }

  watchList(listener: (terminals: TerminalInfo[]) => void): () => void {
    return this.#follow(API_PATHS.terminalsEvents, () => "", {
      [TERMINALS_EVENT]: (data) => {
        const terminals = (data as Partial<TerminalsResponse> | null)?.terminals;
        if (Array.isArray(terminals)) listener(terminals);
      },
    });
  }

  async create(request: CreateTerminalRequest): Promise<Result<TerminalInfo, ApiError>> {
    return this.#send(API_PATHS.terminals, "POST", request) as Promise<
      Result<TerminalInfo, ApiError>
    >;
  }

  async input(id: string, text: string): Promise<Result<null, ApiError>> {
    const result = await this.#send(API_PATHS.terminalInput(id), "POST", { text });
    return result.ok ? ok(null) : result;
  }

  stop(id: string): Promise<Result<TerminalInfo, ApiError>> {
    return this.#send(API_PATHS.terminalStop(id), "POST") as Promise<
      Result<TerminalInfo, ApiError>
    >;
  }

  restart(id: string): Promise<Result<TerminalInfo, ApiError>> {
    return this.#send(API_PATHS.terminalRestart(id), "POST") as Promise<
      Result<TerminalInfo, ApiError>
    >;
  }

  async remove(id: string): Promise<Result<null, ApiError>> {
    const result = await this.#send(API_PATHS.terminal(id), "DELETE");
    return result.ok ? ok(null) : result;
  }

  async output(id: string): Promise<Result<string, ApiError>> {
    const result = await this.#send(`${API_PATHS.terminalOutput(id)}?from=0`, "GET");
    if (!result.ok) return result;
    const data = (result.value as Partial<TerminalOutputResponse> | null)?.data;
    return ok(typeof data === "string" ? data : "");
  }

  stream(id: string, from: number, handlers: TerminalStreamHandlers): () => void {
    // After a reconnect, ask only for what came after the last character shown.
    let next = from;
    return this.#follow(API_PATHS.terminalStream(id), () => `from=${next}`, {
      [TERMINAL_OUTPUT_EVENT]: (data) => {
        const chunk = data as Partial<TerminalOutputChunk> | null;
        if (typeof chunk?.data !== "string" || typeof chunk.seq !== "number") return;
        // A replay after a reconnect can overlap what was already shown.
        const skip = Math.max(0, next - chunk.seq);
        if (skip >= chunk.data.length) return;
        const text = chunk.data.slice(skip);
        next = chunk.seq + chunk.data.length;
        handlers.onOutput({ seq: chunk.seq + skip, data: text });
      },
      [TERMINAL_STATUS_EVENT]: (data) => {
        if (typeof data === "object" && data !== null) handlers.onStatus(data as TerminalInfo);
      },
    });
  }

  /** An event stream that needs the token and reconnects until unsubscribed. */
  #follow(
    path: string,
    query: () => string,
    handlers: Record<string, (data: unknown) => void>,
  ): () => void {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = async () => {
      const token = await this.#getToken();
      if (stopped) return;
      if (!token.ok) {
        retry = setTimeout(() => void connect(), this.#reconnectMs);
        return;
      }
      const extra = query();
      const params = `${TOKEN_PARAM}=${encodeURIComponent(token.value)}${extra ? `&${extra}` : ""}`;
      source = this.#createEventSource(`${this.#baseUrl}${path}?${params}`);
      for (const [type, handle] of Object.entries(handlers)) {
        source.addEventListener(type, (event) => {
          handle(parseJson((event as MessageEvent<string>).data));
        });
      }
      source.onerror = () => {
        source?.close();
        source = null;
        // The token may be from a Studio that restarted; ask for a new one.
        this.#token = null;
        if (!stopped) retry = setTimeout(() => void connect(), this.#reconnectMs);
      };
    };

    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      source?.close();
      source = null;
    };
  }

  async #send(path: string, method: string, body?: unknown): Promise<Result<unknown, ApiError>> {
    const attempt = async (): Promise<Result<unknown, ApiError>> => {
      const token = await this.#getToken();
      if (!token.ok) return token;
      const headers: Record<string, string> = {
        accept: "application/json",
        [TOKEN_HEADER]: token.value,
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      return this.#request(path, init);
    };
    const first = await attempt();
    if (!first.ok && first.error.error === "forbidden") {
      this.#token = null;
      return attempt();
    }
    return first;
  }

  #getToken(): Promise<Result<string, ApiError>> {
    this.#token ??= this.#request(API_PATHS.session, { method: "GET" }).then((response) => {
      if (!response.ok) return response;
      const token = (response.value as Partial<Session> | null)?.token;
      return typeof token === "string"
        ? ok(token)
        : err<ApiError>({
            error: "internal",
            message: "The server did not return a session token.",
          });
    });
    const token = this.#token;
    token.then((result) => {
      if (!result.ok && this.#token === token) this.#token = null;
    });
    return token;
  }

  async #request(path: string, init: RequestInit): Promise<Result<unknown, ApiError>> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, init);
    } catch {
      return err(unreachable);
    }
    const body = parseJson(await response.text().catch(() => ""));
    if (response.ok) return ok(body);
    const error = body as Partial<ApiError> | null;
    return err(
      typeof error?.error === "string" && typeof error.message === "string"
        ? (error as ApiError)
        : { error: "internal", message: `The server answered ${response.status}.` },
    );
  }
}

function parseJson(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
