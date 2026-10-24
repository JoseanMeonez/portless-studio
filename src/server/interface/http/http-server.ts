import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  API_PATHS,
  type CreateAliasRequest,
  type RenameAliasRequest,
  type Session,
  STUDIO_HEADER,
  TOKEN_HEADER,
} from "../../../core/api/contract.ts";
import type { Result } from "../../../core/result.ts";
import type { AppError } from "../../application/app-error.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import {
  createAlias,
  installPortless,
  removeAlias,
  renameAlias,
} from "../../application/route-use-cases.ts";
import type { StudioRuntime } from "../../application/studio-runtime.ts";
import { type BodyError, MAX_BODY_BYTES, readJsonBody, sendError, sendJson } from "./json-io.ts";
import { hasToken, isAllowedHost, isSameOrigin } from "./request-guards.ts";
import { SnapshotEvents } from "./snapshot-events.ts";
import { StaticFiles } from "./static-files.ts";

export type HttpServerOptions = {
  registry: RouteRegistry;
  /** Builds the full snapshot (routes plus detected ports) and owns the config. */
  studio: StudioRuntime;
  /** Per-run secret every write request must carry in `TOKEN_HEADER`. */
  token: string;
  /** Built web app to serve. Without it the server answers only the API. */
  webDir?: string | undefined;
};

export type HttpServer = {
  server: Server;
  /** Ends open event streams; call before `server.close()`. */
  closeStreams(): void;
};

const ALIAS_PREFIX = `${API_PATHS.aliases}/`;
const IGNORE_DETECTED = /^\/api\/detected\/([^/]+)\/ignore$/;

export function createHttpServer(options: HttpServerOptions): HttpServer {
  const events = new SnapshotEvents(options.studio);
  const staticFiles = options.webDir ? new StaticFiles(options.webDir) : null;

  const server = createServer((req, res) => {
    res.setHeader(STUDIO_HEADER, "1");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    handle(req, res).catch(() => {
      if (!res.headersSent) sendError(res, "internal", "Unexpected server error.");
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const { host, origin } = req.headers;
    if (!isAllowedHost(host) || !isSameOrigin(origin, host)) {
      sendError(res, "forbidden", "Requests must come from this machine and this page.");
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }
    if (staticFiles) {
      staticFiles.serve(req, res, pathname);
      return;
    }
    res
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("The web app is not built. Run it with `pnpm dev:web`.");
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const method = req.method ?? "GET";
    const isRead = method === "GET" || method === "HEAD";
    if (!isRead && !hasToken(req.headers[TOKEN_HEADER], options.token)) {
      sendError(res, "forbidden", "Missing or wrong session token.");
      return;
    }

    if (pathname === API_PATHS.session && method === "GET") {
      const session: Session = { token: options.token };
      sendJson(res, 200, session);
      return;
    }
    if (pathname === API_PATHS.snapshot && method === "GET") {
      sendJson(res, 200, await options.studio.readSnapshot());
      return;
    }
    if (pathname === API_PATHS.config && method === "GET") {
      const result = await options.studio.readConfig();
      if (!result.ok) return sendError(res, result.error.code, result.error.message);
      return sendJson(res, 200, result.value);
    }
    if (pathname === API_PATHS.config && method === "PUT") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendBodyError(res, body.error);
      const result = await options.studio.updateConfig(body.value);
      if (!result.ok) return sendError(res, result.error.code, result.error.message);
      return sendJson(res, 200, result.value);
    }
    const ignored = IGNORE_DETECTED.exec(pathname);
    if (ignored?.[1] && method === "POST") {
      return sendResult(res, await options.studio.ignorePort(ignored[1]), 204);
    }
    if (pathname === API_PATHS.events && method === "GET") {
      await events.connect(res);
      return;
    }
    if (pathname === API_PATHS.aliases && method === "POST") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendBodyError(res, body.error);
      const result = await createAlias(options.registry, toCreateRequest(body.value));
      return sendResult(res, result, 201);
    }
    if (pathname === API_PATHS.installPortless && method === "POST") {
      const result = await installPortless(options.registry);
      if (!result.ok) return sendError(res, result.error.code, result.error.message);
      await options.studio.ensureProxy();
      return sendJson(res, 200, result.value);
    }
    if (pathname.startsWith(ALIAS_PREFIX) && (method === "PATCH" || method === "DELETE")) {
      const name = decodeName(pathname.slice(ALIAS_PREFIX.length));
      if (name === null) return sendError(res, "not_found", "No route has that name.");
      if (method === "DELETE") {
        return sendResult(res, await removeAlias(options.registry, name), 204);
      }
      const body = await readJsonBody(req);
      if (!body.ok) return sendBodyError(res, body.error);
      const result = await renameAlias(options.registry, name, toRenameRequest(body.value));
      return sendResult(res, result, 204);
    }
    sendError(res, "not_found", `No API endpoint for ${method} ${pathname}.`);
  }

  return { server, closeStreams: () => events.close() };
}

function sendResult(res: ServerResponse, result: Result<void, AppError>, status: number): void {
  if (!result.ok) {
    sendError(res, result.error.code, result.error.message);
    return;
  }
  res.writeHead(status, { "Cache-Control": "no-store" }).end();
}

// The contract has no generic "bad request" code; a body we cannot read carries no valid name.
function sendBodyError(res: ServerResponse, error: BodyError): void {
  if (error === "too_large") {
    sendError(
      res,
      "invalid_request",
      `The request body is larger than ${MAX_BODY_BYTES} bytes.`,
      413,
    );
    return;
  }
  sendError(res, "invalid_request", "The request body is not valid JSON.");
}

function toCreateRequest(body: unknown): CreateAliasRequest {
  const fields = asRecord(body);
  return {
    name: typeof fields.name === "string" ? fields.name : "",
    port:
      typeof fields.port === "number" || typeof fields.port === "string" ? Number(fields.port) : 0,
    force: fields.force === true,
  };
}

function toRenameRequest(body: unknown): RenameAliasRequest {
  const fields = asRecord(body);
  return { name: typeof fields.name === "string" ? fields.name : "" };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function decodeName(encoded: string): string | null {
  if (encoded === "" || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}
