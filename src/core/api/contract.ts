import type { ProxyStatus, Route } from "../routes/route.ts";

/**
 * The HTTP API between the web app and the server. Both sides import these names, so changing a
 * path or a shape here is a breaking change for any other backend that implements the API.
 */
export const API_PATHS = {
  /** Returns the per-run write token. Same-origin only, so other sites cannot read it. */
  session: "/api/session",
  snapshot: "/api/snapshot",
  /** Server-sent events: one `snapshot` event on connect and after every change. */
  events: "/api/events",
  aliases: "/api/aliases",
  alias: (name: string) => `/api/aliases/${encodeURIComponent(name)}`,
  /** POST: runs `npm install -g portless` on the server. A write, so it needs the token. */
  installPortless: "/api/portless/install",
} as const;

export const SNAPSHOT_EVENT = "snapshot";

/** Header that carries the per-run token on every write request. */
export const TOKEN_HEADER = "x-portless-studio-token";

/** GET /api/session */
export type Session = {
  token: string;
};

/** Whether the portless command runs on the server's machine, and which version it reports. */
export type PortlessInstallation = {
  installed: boolean;
  /** What `portless --version` printed, or null when it is not installed or printed nothing. */
  version: string | null;
};

export type Snapshot = {
  proxy: ProxyStatus;
  portless: PortlessInstallation;
  routes: Route[];
  /** Epoch milliseconds when the server read this state. */
  readAt: number;
};

/** POST /api/aliases */
export type CreateAliasRequest = {
  name: string;
  port: number;
  /** Replace a route that already has this name. */
  force?: boolean;
};

/** PATCH /api/aliases/:name */
export type RenameAliasRequest = {
  name: string;
};

/** POST /api/portless/install, on success. */
export type InstallPortlessResponse = {
  /** The version detected after the install; null when the command still cannot be found. */
  version: string | null;
  /** What npm printed, without color codes, trimmed to its last few kilobytes. */
  output: string;
};

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_name"
  | "invalid_port"
  | "name_taken"
  | "not_found"
  | "not_an_alias"
  | "forbidden"
  | "portless_unavailable"
  /** `npm install -g portless` failed; the message carries what npm printed. */
  | "install_failed"
  /** Another install is still running. */
  | "install_in_progress"
  | "internal";

/** Body of every non-2xx response. */
export type ApiError = {
  error: ApiErrorCode;
  message: string;
};
