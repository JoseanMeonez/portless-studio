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
} as const;

export const SNAPSHOT_EVENT = "snapshot";

/** Header that carries the per-run token on every write request. */
export const TOKEN_HEADER = "x-portless-studio-token";

/** GET /api/session */
export type Session = {
  token: string;
};

export type Snapshot = {
  proxy: ProxyStatus;
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

export type ApiErrorCode =
  | "invalid_name"
  | "invalid_port"
  | "name_taken"
  | "not_found"
  | "not_an_alias"
  | "forbidden"
  | "portless_unavailable"
  | "internal";

/** Body of every non-2xx response. */
export type ApiError = {
  error: ApiErrorCode;
  message: string;
};
