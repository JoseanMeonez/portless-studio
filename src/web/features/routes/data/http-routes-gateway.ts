import {
  API_PATHS,
  type ApiError,
  type CreateAliasRequest,
  type RenameAliasRequest,
  type Session,
  SNAPSHOT_EVENT,
  type Snapshot,
  TOKEN_HEADER,
} from "../../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../../core/result.ts";
import type { ConnectionListener, RoutesGateway, SnapshotListener } from "./routes-gateway.ts";

type HttpRoutesGatewayOptions = {
  /** Origin of the API. Empty means the page's own origin, which is how the server serves it. */
  baseUrl?: string;
  fetch?: typeof fetch;
  createEventSource?: (url: string) => EventSource;
  /** Waits between reconnect attempts, in milliseconds; the last one repeats. */
  reconnectDelays?: readonly number[];
};

const DEFAULT_RECONNECT_DELAYS = [500, 1000, 2000, 5000, 10_000];

const unreachable: ApiError = {
  error: "internal",
  message: "Could not reach the Portless Studio server. Is it still running?",
};

/** `RoutesGateway` over the HTTP API in `core/api/contract.ts`, with live updates through SSE. */
export class HttpRoutesGateway implements RoutesGateway {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #createEventSource: (url: string) => EventSource;
  readonly #reconnectDelays: readonly number[];
  // Fetched on the first write and reused; cleared when the server says it is no longer valid.
  #token: Promise<Result<string, ApiError>> | null = null;

  constructor(options: HttpRoutesGatewayOptions = {}) {
    this.#baseUrl = options.baseUrl ?? "";
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#createEventSource = options.createEventSource ?? ((url) => new EventSource(url));
    this.#reconnectDelays = options.reconnectDelays ?? DEFAULT_RECONNECT_DELAYS;
  }

  async getSnapshot(): Promise<Result<Snapshot, ApiError>> {
    const response = await this.#request(API_PATHS.snapshot, { method: "GET" });
    if (!response.ok) return response;
    return isSnapshot(response.value)
      ? ok(response.value)
      : err({ error: "internal", message: "The server sent a snapshot this app cannot read." });
  }

  subscribe(listener: SnapshotListener, onConnectionChange?: ConnectionListener): () => void {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let stopped = false;

    const connect = () => {
      source = this.#createEventSource(this.#url(API_PATHS.events));
      source.onopen = () => {
        failures = 0;
        onConnectionChange?.("open");
      };
      source.addEventListener(SNAPSHOT_EVENT, (event) => {
        const snapshot = parseSnapshot((event as MessageEvent<string>).data);
        if (snapshot) listener(snapshot);
      });
      // We reconnect ourselves: the browser gives up for good after some server errors.
      source.onerror = () => {
        source?.close();
        source = null;
        if (stopped) return;
        onConnectionChange?.("reconnecting");
        const delays = this.#reconnectDelays;
        const delay = delays[Math.min(failures, delays.length - 1)] ?? 1000;
        failures += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    onConnectionChange?.("connecting");
    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      source = null;
    };
  }

  createAlias(request: CreateAliasRequest): Promise<Result<null, ApiError>> {
    return this.#write(API_PATHS.aliases, "POST", request);
  }

  renameAlias(currentName: string, request: RenameAliasRequest): Promise<Result<null, ApiError>> {
    return this.#write(API_PATHS.alias(currentName), "PATCH", request);
  }

  removeAlias(name: string): Promise<Result<null, ApiError>> {
    return this.#write(API_PATHS.alias(name), "DELETE");
  }

  async #write(path: string, method: string, body?: unknown): Promise<Result<null, ApiError>> {
    const attempt = async (): Promise<Result<null, ApiError>> => {
      const token = await this.#getToken();
      if (!token.ok) return token;
      const headers: Record<string, string> = { [TOKEN_HEADER]: token.value };
      if (body !== undefined) headers["content-type"] = "application/json";
      const init: RequestInit = { method, headers };
      if (body !== undefined) init.body = JSON.stringify(body);
      const response = await this.#request(path, init);
      return response.ok ? ok(null) : response;
    };

    const first = await attempt();
    // A restarted server issues a new token; fetch it once and try again.
    if (!first.ok && first.error.error === "forbidden") {
      this.#token = null;
      return attempt();
    }
    return first;
  }

  #getToken(): Promise<Result<string, ApiError>> {
    this.#token ??= this.#request(API_PATHS.session, { method: "GET" }).then((response) => {
      if (!response.ok) return response;
      const session = response.value as Partial<Session> | null;
      return typeof session?.token === "string"
        ? ok(session.token)
        : err<ApiError>({
            error: "internal",
            message: "The server did not return a session token.",
          });
    });
    const token = this.#token;
    // Do not keep a failure cached: the next write should ask again.
    token.then((result) => {
      if (!result.ok && this.#token === token) this.#token = null;
    });
    return token;
  }

  async #request(path: string, init: RequestInit): Promise<Result<unknown, ApiError>> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url(path), {
        ...init,
        headers: { accept: "application/json", ...(init.headers as Record<string, string>) },
      });
    } catch {
      return err(unreachable);
    }

    const text = await response.text().catch(() => "");
    const body = parseJson(text);
    if (response.ok) return ok(body);
    return err(
      isApiError(body)
        ? body
        : { error: "internal", message: `The server answered ${response.status}.` },
    );
  }

  #url(path: string): string {
    return `${this.#baseUrl}${path}`;
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

function parseSnapshot(data: string): Snapshot | null {
  const value = parseJson(data);
  return isSnapshot(value) ? value : null;
}

function isSnapshot(value: unknown): value is Snapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Snapshot>;
  return (
    Array.isArray(candidate.routes) &&
    typeof candidate.proxy === "object" &&
    candidate.proxy !== null
  );
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ApiError>;
  return typeof candidate.error === "string" && typeof candidate.message === "string";
}
