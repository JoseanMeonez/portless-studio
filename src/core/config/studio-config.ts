import { DEFAULT_NAME_TEMPLATE, parseNameTemplate } from "../ports/name-template.ts";
import { projectIconKind } from "../projects/project-icon.ts";
import { err, ok, type Result } from "../result.ts";
import { DEFAULT_VIEW, isItemKey, parseViews, type View } from "../views/view.ts";

/** How the terminal panel draws text. See docs/terminals.md. */
export type TerminalAppearance = {
  /** Pixels, 10 to 24. */
  fontSize: number;
  /** Line height as a multiple of the font size, 1 to 2. */
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
  /** Lines kept above the screen, 1000 to 100000. */
  scrollback: number;
  /** `studio` follows the page's light or dark mode; `dark` and `light` stay fixed. */
  theme: "studio" | "dark" | "light";
};

/**
 * What Studio does on start with the terminals that were running when it stopped: list them with
 * a Run again button (`ask`), run their commands again (`always`, never plain shells), or forget
 * them (`never`).
 */
export type RestoreTerminals = "ask" | "always" | "never";

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
  /**
   * Process names (case-insensitive) whose ports are never shown, e.g. editors and chat apps. A
   * name also covers processes that start with it and a space, dot, dash or parenthesis, so
   * `code` covers `Code Helper (Plugin)`.
   */
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
  /**
   * Icon per project name (the repository folder): an emoji, an http(s) URL Studio fetches and
   * inlines, or a `data:image` URL. Projects without one show their server's favicon.
   */
  projectIcons: Record<string, string>;
  /**
   * How suggested names are built from tokens such as `{work}`, `{package}` and `{repo}`. The
   * default `{work}.{package}.{repo}` gives `ed-1234.web.acme`; docs/naming.md lists every token.
   */
  nameTemplate: string;
  /**
   * Ask the npm registry once a day whether a newer portless-studio exists, and say so on start
   * and in the page. `PORTLESS_STUDIO_NO_UPDATE_CHECK=1` also turns it off.
   */
  checkForUpdates: boolean;
  /**
   * Drop the port from names (`http://name.localhost`): Studio listens on port 80 itself and
   * forwards to the proxy on `proxyPort`, only when the system lets this user bind port 80
   * without sudo. Names keep `:<proxyPort>` while it cannot. HTTP only.
   */
  shortUrls: boolean;
  /** List Studio's own `studio` route among the routes; hidden by default. */
  showStudioRoute: boolean;
  /**
   * List detected ports in the system's ephemeral range (where a program that asks for any free
   * port lands) with the others. Off by default: dev servers pick fixed ports, and these are
   * helper ports of tools like wrangler; they still show under "Other ports".
   */
  showEphemeralPorts: boolean;
  /** Font, cursor, scrollback and colors of the terminal panel. */
  terminal: TerminalAppearance;
  /** Terminals that were running when Studio stopped; see `RestoreTerminals`. */
  restoreTerminals: RestoreTerminals;
  /**
   * The app each row's editor button opens the project in: an id from the open-with list, like
   * `vscode` or `custom-1`. Null uses the first editor found on this machine.
   */
  defaultEditor: string | null;
};

export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
  fontSize: 12,
  lineHeight: 1.2,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 10_000,
  theme: "studio",
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
  // Editors, chat and browsers everywhere, plus macOS system services that answer HTTP
  // (ControlCenter on 5000 and 7000, rapportd) and Electron apps run from their own binary.
  ignoredProcesses: [
    "code",
    "cursor",
    "discord",
    "slack",
    "spotify",
    "chrome",
    "google chrome",
    "firefox",
    "electron",
    "controlcenter",
    "rapportd",
  ],
  views: [DEFAULT_VIEW],
  defaultViewId: DEFAULT_VIEW.id,
  favorites: [],
  autoRemoveAfterMinutes: 10,
  desktopNotifications: false,
  systemNotifications: false,
  projectIcons: {},
  nameTemplate: DEFAULT_NAME_TEMPLATE,
  checkForUpdates: true,
  shortUrls: false,
  showStudioRoute: false,
  showEphemeralPorts: false,
  terminal: DEFAULT_TERMINAL_APPEARANCE,
  restoreTerminals: "ask",
  defaultEditor: null,
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
    "checkForUpdates",
    "shortUrls",
    "showStudioRoute",
    "showEphemeralPorts",
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

  if (raw.projectIcons !== undefined) {
    const icons = parseProjectIcons(raw.projectIcons);
    if (icons === null) {
      return err(
        `"projectIcons" must map project names to an emoji, an http(s) URL or a data:image URL.`,
      );
    }
    config.projectIcons = icons;
  }

  if (raw.nameTemplate !== undefined) {
    if (typeof raw.nameTemplate !== "string") return err(`"nameTemplate" must be text.`);
    const template = raw.nameTemplate.trim();
    const parsed = parseNameTemplate(template);
    if (!parsed.ok) return err(`"nameTemplate" ${parsed.error}`);
    config.nameTemplate = template;
  }

  if (raw.terminal !== undefined) {
    const terminal = parseTerminalAppearance(raw.terminal);
    if (!terminal.ok) return terminal;
    config.terminal = terminal.value;
  }

  if (raw.restoreTerminals !== undefined) {
    const value = raw.restoreTerminals;
    if (value !== "ask" && value !== "always" && value !== "never") {
      return err(`"restoreTerminals" must be "ask", "always" or "never".`);
    }
    config.restoreTerminals = value;
  }

  if (raw.defaultEditor !== undefined) {
    const value = raw.defaultEditor;
    if (value !== null && (typeof value !== "string" || !APP_ID.test(value))) {
      return err(`"defaultEditor" must be the id of an app in Open with, like "vscode", or null.`);
    }
    config.defaultEditor = value;
  }

  return ok(config);
}

/** The shape of open-with app ids: `vscode`, `vscode-insiders`, `custom-1`. */
const APP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function parseTerminalAppearance(input: unknown): Result<TerminalAppearance, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return err(`"terminal" must be an object.`);
  }
  const raw = input as Record<string, unknown>;
  const terminal: TerminalAppearance = { ...DEFAULT_TERMINAL_APPEARANCE };
  if (raw.fontSize !== undefined) {
    if (!isWholeBetween(raw.fontSize, 10, 24)) {
      return err(`"terminal.fontSize" must be a whole number from 10 to 24.`);
    }
    terminal.fontSize = raw.fontSize;
  }
  if (raw.lineHeight !== undefined) {
    const value = raw.lineHeight;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 2) {
      return err(`"terminal.lineHeight" must be a number from 1 to 2.`);
    }
    terminal.lineHeight = value;
  }
  if (raw.cursorStyle !== undefined) {
    const value = raw.cursorStyle;
    if (value !== "block" && value !== "bar" && value !== "underline") {
      return err(`"terminal.cursorStyle" must be "block", "bar" or "underline".`);
    }
    terminal.cursorStyle = value;
  }
  if (raw.cursorBlink !== undefined) {
    if (typeof raw.cursorBlink !== "boolean") {
      return err(`"terminal.cursorBlink" must be true or false.`);
    }
    terminal.cursorBlink = raw.cursorBlink;
  }
  if (raw.scrollback !== undefined) {
    if (!isWholeBetween(raw.scrollback, 1000, 100_000)) {
      return err(`"terminal.scrollback" must be a whole number from 1000 to 100000.`);
    }
    terminal.scrollback = raw.scrollback;
  }
  if (raw.theme !== undefined) {
    const value = raw.theme;
    if (value !== "studio" && value !== "dark" && value !== "light") {
      return err(`"terminal.theme" must be "studio", "dark" or "light".`);
    }
    terminal.theme = value;
  }
  return ok(terminal);
}

function isWholeBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Empty names and values are dropped, so clearing a field in the panel removes its icon. */
function parseProjectIcons(value: unknown): Record<string, string> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const icons: Record<string, string> = {};
  for (const [rawName, rawIcon] of Object.entries(value)) {
    if (typeof rawIcon !== "string") return null;
    const name = rawName.trim();
    const icon = rawIcon.trim();
    if (name === "" || name === "__proto__" || icon === "") continue;
    if (projectIconKind(icon) === null) return null;
    icons[name] = icon;
  }
  return icons;
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}
