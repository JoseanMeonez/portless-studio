import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { API_PATHS, STUDIO_HEADER, TOKEN_HEADER } from "../../core/api/contract.ts";
import { err, ok, type Result } from "../../core/result.ts";

/**
 * A client of a running Studio's HTTP API. Writes go through Studio, not straight to portless,
 * so the dashboard sees every change at once through its event stream.
 */
export type StudioClient = {
  baseUrl: string;
  read(path: string): Promise<Result<unknown, StudioClientError>>;
  write(
    method: WriteMethod,
    path: string,
    body?: unknown,
  ): Promise<Result<unknown, StudioClientError>>;
};

export type WriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export type StudioClientError = {
  /** `not_running`: nothing answers; `not_studio`: something else does; `api`: Studio said no. */
  kind: "not_running" | "not_studio" | "api";
  message: string;
  /** A command Studio suggests running instead, when it has one. */
  command?: string;
};

const TIMEOUT_MS = 60_000;

/** `PORTLESS_STUDIO_URL` when set, else Studio's port from the config on 127.0.0.1. */
export function resolveStudioUrl(
  override: string | undefined,
  configPort: number,
): Result<string, string> {
  if (!override) return ok(`http://127.0.0.1:${configPort}`);
  let url: URL;
  try {
    url = new URL(override);
  } catch {
    return err(`PORTLESS_STUDIO_URL "${override}" is not a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err(`PORTLESS_STUDIO_URL "${override}" must start with http:// or https://.`);
  }
  return ok(url.origin);
}

export function createStudioClient(baseUrl: string): StudioClient {
  let token: string | null = null;
  const notRunning: StudioClientError = {
    kind: "not_running",
    message:
      `Portless Studio is not running at ${baseUrl}. Ask the user to start it with ` +
      "`portless-studio` (or `portless-studio service install` to start it at login), then try again.",
  };

  async function send(method: string, path: string, body?: unknown, withToken?: string) {
    const raw = await sendRaw(new URL(path, baseUrl), method, body, withToken);
    if (!raw.ok) return err(raw.error === "refused" ? notRunning : failed(raw.error));
    if (!raw.value.studio) {
      return err<StudioClientError>({
        kind: "not_studio",
        message: `Something that is not Portless Studio answers at ${baseUrl}. Check the port in the Studio config or PORTLESS_STUDIO_URL.`,
      });
    }
    return ok(raw.value);
  }

  async function sessionToken(): Promise<Result<string, StudioClientError>> {
    const answer = await send("GET", API_PATHS.session);
    if (!answer.ok) return answer;
    const value = isRecord(answer.value.body) ? answer.value.body.token : undefined;
    if (answer.value.status !== 200 || typeof value !== "string") {
      return err(failed("Studio did not hand out a session token."));
    }
    token = value;
    return ok(value);
  }

  async function read(path: string) {
    const answer = await send("GET", path);
    return answer.ok ? toResult(answer.value) : answer;
  }

  async function write(method: WriteMethod, path: string, body?: unknown) {
    let first = true;
    while (true) {
      const current = token === null ? await sessionToken() : ok(token);
      if (!current.ok) return current;
      const answer = await send(method, path, body, current.value);
      if (!answer.ok) return answer;
      // Studio makes a new token each run; after a restart, ask for the new one once.
      if (answer.value.status === 403 && first) {
        first = false;
        token = null;
        continue;
      }
      return toResult(answer.value);
    }
  }

  return { baseUrl, read, write };
}

type RawAnswer = { status: number; studio: boolean; body: unknown };

function toResult(answer: RawAnswer): Result<unknown, StudioClientError> {
  if (answer.status >= 200 && answer.status < 300) return ok(answer.body);
  const body = isRecord(answer.body) ? answer.body : {};
  const message =
    typeof body.message === "string" ? body.message : `Studio answered HTTP ${answer.status}.`;
  return err({
    kind: "api",
    message,
    ...(typeof body.command === "string" ? { command: body.command } : {}),
  });
}

function failed(message: string): StudioClientError {
  return { kind: "api", message };
}

// node:http sets Host to the URL's host and sends no Origin, which is what Studio's guards accept.
function sendRaw(
  url: URL,
  method: string,
  body: unknown,
  token: string | undefined,
): Promise<Result<RawAnswer, "refused" | string>> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  if (token !== undefined) headers[TOKEN_HEADER] = token;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve) => {
    const req = request(url, { method, headers, timeout: TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", (error) => resolve(err(error.message)));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed: unknown = null;
        if (text !== "") {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }
        }
        resolve(
          ok({
            status: res.statusCode ?? 0,
            studio: res.headers[STUDIO_HEADER] === "1",
            body: parsed,
          }),
        );
      });
    });
    req.on("timeout", () =>
      req.destroy(new Error(`Studio did not answer in ${TIMEOUT_MS / 1000} s.`)),
    );
    req.on("error", (error: NodeJS.ErrnoException) => {
      const refused = ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH"];
      resolve(err(refused.includes(error.code ?? "") ? "refused" : error.message));
    });
    req.end(payload);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
