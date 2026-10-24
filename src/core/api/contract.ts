import type { StudioConfig } from "../config/studio-config.ts";
import type { DoctorCheck } from "../doctor/doctor-check.ts";
import type { DetectedPort } from "../ports/detected-port.ts";
import type { CustomApp } from "../projects/custom-app.ts";
import type { ProxyStatus, Route } from "../routes/route.ts";

/**
 * The HTTP API between the web app and the server. Both sides import these names, so changing a
 * path or a shape here is a breaking change for any other backend that implements the API.
 */
export const API_PATHS = {
  /** Returns the per-run write token. Same-origin only, so other sites cannot read it. */
  session: "/api/session",
  snapshot: "/api/snapshot",
  /**
   * Server-sent events: one `snapshot` event on connect and after every change, plus one `event`
   * per notable change (`StudioEvent`), the recent ones replayed on connect.
   */
  events: "/api/events",
  aliases: "/api/aliases",
  alias: (name: string) => `/api/aliases/${encodeURIComponent(name)}`,
  /** POST: runs `npm install -g portless` on the server. A write, so it needs the token. */
  installPortless: "/api/portless/install",
  /** GET returns the StudioConfig; PUT replaces it (a write, needs the token). */
  config: "/api/config",
  /** POST: adds the port to `ignoredPorts`, so it stops showing as detected. */
  ignoreDetected: (port: number) => `/api/detected/${port}/ignore`,
  /** GET: runs every health check and returns `DoctorReport`. */
  doctor: "/api/doctor",
  /** POST: runs the safe fix of the check with this id; answers `DoctorFixResponse`. */
  doctorFix: (id: string) => `/api/doctor/fix/${encodeURIComponent(id)}`,
  /** POST: starts, stops or restarts the portless proxy. */
  proxy: (action: ProxyAction) => `/api/proxy/${action}`,
  /** POST: restarts or stops Studio itself; answers 202 before Studio goes away. */
  studio: (action: StudioAction) => `/api/studio/${action}`,
  /** POST: stops a dev server listening on a detected or routed port. */
  stopProcess: (pid: number) => `/api/processes/${pid}/stop`,
  /** GET: the editors found on this machine, the file manager and the custom apps. */
  openWithApps: "/api/open-with/apps",
  /** POST `OpenWithRequest`: opens a folder Studio knows with one of those apps. */
  openWith: "/api/open-with",
  /** GET returns `CustomAppsResponse`; PUT replaces the list (a write, needs the token). */
  customApps: "/api/open-with/custom-apps",
} as const;

export type ProxyAction = "start" | "stop" | "restart";
export type StudioAction = "restart" | "stop";

export const SNAPSHOT_EVENT = "snapshot";

/** Server-sent event type that carries one `StudioEvent`. */
export const STUDIO_EVENT = "event";

/**
 * What happened: a dev server appeared (`detected`), a route got a name (`named`) or lost it
 * (`removed`), a route stopped (`down`) or started answering again (`up`), or the proxy started
 * or stopped (`proxy`).
 */
export type StudioEventKind = "detected" | "named" | "removed" | "down" | "up" | "proxy";

/** One notification. The page shows it in the app; the OS can show it too. */
export type StudioEvent = {
  /** Unique for this server run; the page uses it to show each event once. */
  id: string;
  kind: StudioEventKind;
  title: string;
  body: string;
  /** What clicking the notification shows: a route by name, or a port. */
  target: { route?: string; port?: number };
  /** Epoch milliseconds. */
  at: number;
};

/** Sent on every Studio response, so one Studio never lists another as a dev server. */
export const STUDIO_HEADER = "x-portless-studio";

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
  /** Ports that answer HTTP, are not ignored and have no portless route yet. */
  detected: DetectedPort[];
  /** Whether auto mode is on, so the UI can say so without fetching the config. */
  autoName: boolean;
  /**
   * Icon per project name, for group headers: the one set in the config, else the first icon one
   * of its servers has. Absent from older servers.
   */
  projectIcons?: Record<string, string>;
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

/** `editor` and `file-manager` were found on this machine; `custom` were added in Settings. */
export type OpenWithAppKind = "editor" | "file-manager" | "custom";

export type OpenWithApp = {
  /** Stable for this machine, e.g. `vscode`, `zed`, `file-manager`, `custom-1`. */
  id: string;
  name: string;
  kind: OpenWithAppKind;
};

/** GET /api/open-with/apps */
export type OpenWithAppsResponse = {
  apps: OpenWithApp[];
};

/** POST /api/open-with */
export type OpenWithRequest = {
  appId: string;
  /** Must be the project folder of a route or detected port Studio shows, or showed before. */
  path: string;
};

/** GET and PUT /api/open-with/custom-apps; PUT sends only `apps`. */
export type CustomAppsResponse = {
  apps: CustomApp[];
  /** Where the JSON file lives, so people can edit it by hand. */
  path: string;
};

/** GET /api/doctor */
export type DoctorReport = {
  checks: DoctorCheck[];
};

/** POST /api/doctor/fix/:id, on success: what was done and the checks run again afterwards. */
export type DoctorFixResponse = {
  message: string;
  checks: DoctorCheck[];
};

/** POST /api/proxy/:action, on success. */
export type ProxyActionResponse = {
  message: string;
};

/** POST /api/studio/:action: sent with 202 just before Studio restarts or exits. */
export type StudioActionResponse = {
  message: string;
  /** How to start Studio again after a stop. */
  startCommand: string;
};

/** GET /api/config and the body of PUT /api/config. */
export type ConfigResponse = {
  config: StudioConfig;
  /** Where the JSON file lives, so people can edit it by hand. */
  path: string;
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
  /** PUT /api/config with a value parseConfig rejects; the message names the field. */
  | "invalid_config"
  /** The process belongs to root or another user; the error carries the command to run. */
  | "needs_admin"
  /** The pid does not listen on a detected or routed port, or is not the current user's. */
  | "process_not_allowed"
  /** This system cannot do it, e.g. restarting Studio as a service on Windows. */
  | "unsupported"
  /** A system command failed; the message carries what it printed. */
  | "command_failed"
  /** No app with that id was found on this machine or among the custom apps. */
  | "unknown_app"
  /** The folder is not one Studio shows, so it will not open it. */
  | "path_not_allowed"
  | "internal";

/** Body of every non-2xx response. */
export type ApiError = {
  error: ApiErrorCode;
  message: string;
  /** A command the person can copy and run instead, when the server cannot do it. */
  command?: string;
};
