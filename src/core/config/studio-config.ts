import { err, ok, type Result } from "../result.ts";
import { DEFAULT_VIEW, isItemKey, parseViews, type View } from "../views/view.ts";

/** Settings people edit in the JSON file or in the settings panel. Every field has a default. */
export type StudioConfig = {
  /** Port the Studio server listens on. */
  port: number;
  /** Give every newly detected dev server a portless name without asking. */
  autoName: boolean;
  /** Open the browser when Studio starts. */
  openBrowser: boolean;
  /** Register Studio itself in portless as `studio`. */
  registerStudioAlias: boolean;
  /** Start the portless proxy when Studio starts and it is not running. */
  startProxy: boolean;
  /**
   * Port for the proxy Studio starts. The default 1355 needs no administrator rights on any
   * system; 443 gives URLs without a port but needs sudo once.
   */
  proxyPort: number;
  /**
   * Serve the names over HTTPS. Off by default: browsers only trust the local certificate after
   * extra system setup, and plain HTTP on a `.localhost` name is already treated as secure.
   */
  proxyHttps: boolean;
  /** How often to look for new listening ports, in milliseconds. */
  scanIntervalMs: number;
  /** Ports never shown as detected and never named automatically. */
  ignoredPorts: number[];
  /** Process names (case-insensitive) whose ports are never shown, e.g. editors and chat apps. */
  ignoredProcesses: string[];
  /** Saved ways to group, sort and filter the dashboard. Always at least one. */
  views: View[];
  /** The view the dashboard opens with; the id of one of `views`. */
  defaultViewId: string;
  /** Rows pinned above every view: route names or `port:<number>`. */
  favorites: string[];
  /**
   * Minutes a name given by auto mode survives after its port closes; 0 keeps them forever.
   * Names a person or an agent gave are never removed.
   */
  autoRemoveAfterMinutes: number;
  /** Show a desktop notification from an open Studio tab while it is in the background. */
  desktopNotifications: boolean;
  /** Ask the operating system to notify when no Studio tab is open. */
  systemNotifications: boolean;
};

export const DEFAULT_CONFIG: StudioConfig = {
  port: 4949,
  autoName: false,
  openBrowser: true,
  registerStudioAlias: true,
  startProxy: true,
  proxyPort: 1355,
  proxyHttps: false,
  scanIntervalMs: 3000,
  ignoredPorts: [],
  ignoredProcesses: ["code", "cursor", "discord", "slack", "spotify", "chrome", "firefox"],
  views: [DEFAULT_VIEW],
  defaultViewId: DEFAULT_VIEW.id,
  favorites: [],
  autoRemoveAfterMinutes: 10,
  desktopNotifications: false,
  systemNotifications: false,
};

const MIN_SCAN_INTERVAL_MS = 1000;

/**
 * Reads a config from untrusted JSON: missing fields take their default, wrong types are an error
 * that names the field, unknown fields are dropped.
 */
export function parseConfig(input: unknown): Result<StudioConfig, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err("The config must be a JSON object.");
  }
  const raw = input as Record<string, unknown>;
  const config: StudioConfig = { ...DEFAULT_CONFIG };

  for (const key of [
    "autoName",
    "openBrowser",
    "registerStudioAlias",
    "startProxy",
    "proxyHttps",
    "desktopNotifications",
    "systemNotifications",
  ] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return err(`"${key}" must be true or false.`);
    config[key] = value;
  }

  if (raw.port !== undefined) {
    if (!isPort(raw.port)) return err(`"port" must be a whole number from 1 to 65535.`);
    config.port = raw.port;
  }

  if (raw.proxyPort !== undefined) {
    if (!isPort(raw.proxyPort)) return err(`"proxyPort" must be a whole number from 1 to 65535.`);
    config.proxyPort = raw.proxyPort;
  }

  if (raw.scanIntervalMs !== undefined) {
    const value = raw.scanIntervalMs;
    if (typeof value !== "number" || !Number.isInteger(value) || value < MIN_SCAN_INTERVAL_MS) {
      return err(`"scanIntervalMs" must be a whole number of at least ${MIN_SCAN_INTERVAL_MS}.`);
    }
    config.scanIntervalMs = value;
  }

  if (raw.autoRemoveAfterMinutes !== undefined) {
    const value = raw.autoRemoveAfterMinutes;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return err(`"autoRemoveAfterMinutes" must be a whole number, 0 or more.`);
    }
    config.autoRemoveAfterMinutes = value;
  }

  if (raw.ignoredPorts !== undefined) {
    const value = raw.ignoredPorts;
    if (!Array.isArray(value) || !value.every(isPort)) {
      return err(`"ignoredPorts" must be a list of port numbers.`);
    }
    config.ignoredPorts = [...new Set(value)].sort((a, b) => a - b);
  }

  if (raw.ignoredProcesses !== undefined) {
    const value = raw.ignoredProcesses;
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      return err(`"ignoredProcesses" must be a list of process names.`);
    }
    config.ignoredProcesses = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  }

  if (raw.views !== undefined) {
    const views = parseViews(raw.views);
    if (!views.ok) return views;
    config.views = views.value;
  }

  // A missing default falls back to the first view, so a hand-written list of views just works.
  config.defaultViewId = config.views[0]?.id ?? DEFAULT_VIEW.id;
  if (raw.defaultViewId !== undefined) {
    const id = raw.defaultViewId;
    if (typeof id !== "string" || !config.views.some((view) => view.id === id)) {
      return err(`"defaultViewId" must be the id of one of the views.`);
    }
    config.defaultViewId = id;
  }

  if (raw.favorites !== undefined) {
    const value = raw.favorites;
    if (!Array.isArray(value) || !value.every(isItemKey)) {
      return err(`"favorites" must be a list of route names or "port:<number>".`);
    }
    config.favorites = [...new Set(value)];
  }

  return ok(config);
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}
