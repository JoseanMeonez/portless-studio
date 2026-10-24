import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  API_PATHS,
  type CreateAliasRequest,
  type DoctorFixResponse,
  type DoctorReport,
  type OpenWithAppsResponse,
  type ProxyAction,
  type RenameAliasRequest,
  type Session,
  STUDIO_HEADER,
  type StudioAction,
  type StudioActionResponse,
  TOKEN_HEADER,
} from "../../../core/api/contract.ts";
import type { Result } from "../../../core/result.ts";
import type { AppError } from "../../application/app-error.ts";
import type { DoctorService } from "../../application/doctor.ts";
import type { OpenWith } from "../../application/open-with.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import {
  createAlias,
  installPortless,
  removeAlias,
  renameAlias,
} from "../../application/route-use-cases.ts";
import type { StudioRuntime } from "../../application/studio-runtime.ts";
import type { StudioServiceControl } from "../../application/studio-service.ts";
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
  /** Health checks and their fixes; without it `/api/doctor` answers `unsupported`. */
  doctor?: DoctorService;
  controlProxy?: (action: ProxyAction) => Promise<Result<string, AppError>>;
  /** Restarts or stops Studio itself; given by the CLI, which knows how Studio was started. */
  studioService?: StudioServiceControl;
  /** Stops a dev server by pid, after checking it is the user's and listens on a shown port. */
  stopProcess?: (pid: string) => Promise<Result<unknown, AppError>>;
  /** Opens project folders in editors; without it the open-with endpoints answer `unsupported`. */
  openWith?: OpenWith;
};

export type HttpServer = {
  server: Server;
  /** Ends open event streams; call before `server.close()`. */
  closeStreams(): void;
};

const ALIAS_PREFIX = `${API_PATHS.aliases}/`;
const IGNORE_DETECTED = /^\/api\/detected\/([^/]+)\/ignore$/;
const DOCTOR_FIX = /^\/api\/doctor\/fix\/([^/]+)$/;
const PROXY_ACTION = /^\/api\/proxy\/(start|stop|restart)$/;
const STUDIO_ACTION = /^\/api\/studio\/(restart|stop)$/;
const STOP_PROCESS = /^\/api\/processes\/([^/]+)\/stop$/;
/** Lets the 202 reach the browser before Studio restarts or exits. */
const STUDIO_ACTION_DELAY_MS = 200;
const unsupported: AppError = { code: "unsupported", message: "This Studio cannot do that." };

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
    if (pathname === API_PATHS.doctor && method === "GET") {
      if (!options.doctor) return sendAppError(res, unsupported);
      const report: DoctorReport = { checks: await options.doctor.check() };
      return sendJson(res, 200, report);
    }
    const fix = DOCTOR_FIX.exec(pathname);
    if (fix?.[1] && method === "POST") {
      if (!options.doctor) return sendAppError(res, unsupported);
      const id = decodeName(fix[1]);
      if (id === null) return sendError(res, "not_found", "No check has that id.");
      const result = await options.doctor.fix(id);
      if (!result.ok) return sendAppError(res, result.error);
      const body: DoctorFixResponse = result.value;
      return sendJson(res, 200, body);
    }
    const proxyAction = PROXY_ACTION.exec(pathname)?.[1] as ProxyAction | undefined;
    if (proxyAction && method === "POST") {
      if (!options.controlProxy) return sendAppError(res, unsupported);
      const result = await options.controlProxy(proxyAction);
      if (!result.ok) return sendAppError(res, result.error);
      return sendJson(res, 200, { message: result.value });
    }
    const studioAction = STUDIO_ACTION.exec(pathname)?.[1] as StudioAction | undefined;
    if (studioAction && method === "POST") {
      if (!options.studioService) return sendAppError(res, unsupported);
      const prepared = await options.studioService.prepare(studioAction);
      if (!prepared.ok) return sendAppError(res, prepared.error);
      const { message, startCommand, run } = prepared.value;
      const body: StudioActionResponse = { message, startCommand };
      res.once("finish", () => setTimeout(() => void run(), STUDIO_ACTION_DELAY_MS));
      return sendJson(res, 202, body);
    }
    const stop = STOP_PROCESS.exec(pathname);
    if (stop?.[1] && method === "POST") {
      if (!options.stopProcess) return sendAppError(res, unsupported);
      const result = await options.stopProcess(stop[1]);
      if (!result.ok) return sendAppError(res, result.error);
      res.writeHead(204, { "Cache-Control": "no-store" }).end();
      return;
    }
    if (pathname.startsWith(`${API_PATHS.openWith}/`) || pathname === API_PATHS.openWith) {
      return handleOpenWith(req, res, pathname, method);
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

  async function handleOpenWith(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    method: string,
  ): Promise<void> {
    const openWith = options.openWith;
    if (!openWith) return sendAppError(res, unsupported);
    if (pathname === API_PATHS.openWithApps && method === "GET") {
      const body: OpenWithAppsResponse = { apps: await openWith.apps() };
      return sendJson(res, 200, body);
    }
    if (pathname === API_PATHS.openWith && method === "POST") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendBodyError(res, body.error);
      return sendResult(res, await openWith.open(body.value), 204);
    }
    if (pathname === API_PATHS.customApps && method === "GET") {
      return sendJson(res, 200, await openWith.readCustomApps());
    }
    if (pathname === API_PATHS.customApps && method === "PUT") {
      const body = await readJsonBody(req);
      if (!body.ok) return sendBodyError(res, body.error);
      const result = await openWith.updateCustomApps(body.value);
      if (!result.ok) return sendAppError(res, result.error);
      return sendJson(res, 200, result.value);
    }
    sendError(res, "not_found", `No API endpoint for ${method} ${pathname}.`);
  }

  return { server, closeStreams: () => events.close() };
}

function sendAppError(res: ServerResponse, error: AppError): void {
  sendError(res, error.code, error.message, undefined, error.command);
}

function sendResult(res: ServerResponse, result: Result<void, AppError>, status: number): void {
  if (!result.ok) {
    sendAppError(res, result.error);
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
