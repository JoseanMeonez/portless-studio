import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import type { StudioConfig } from "../core/config/studio-config.ts";
import { err, ok, type Result } from "../core/result.ts";
import { parsePort } from "../core/routes/route-name.ts";

export const DEFAULT_PORT = 4949;

/** Flags given to `portless-studio` itself; each one wins over the same setting in the config. */
export type StartOverrides = { port?: number; open?: boolean; register?: boolean };

export type ServiceAction = "install" | "uninstall" | "status";

export type CliOptions =
  | { command: "help" }
  | { command: "version" }
  | { command: "start"; overrides: StartOverrides }
  | { command: "init"; yes: boolean }
  | { command: "uninstall"; yes: boolean }
  | { command: "service"; action: ServiceAction }
  | { command: "config"; edit: boolean; json: boolean }
  | { command: "doctor"; json: boolean }
  | { command: "list"; json: boolean }
  | { command: "mcp" }
  | { command: "run"; cwd: string | null; name: string | null; argv: string[] }
  | { command: "open"; target: string | null };

export type StartSettings = { port: number; open: boolean; register: boolean };

export const HELP = `portless-studio: a local web dashboard for portless routes

Usage:
  portless-studio [options]           Start Studio
  portless-studio init [--yes]        Set everything up: portless, settings, names, proxy
  portless-studio uninstall [--yes]   Undo the setup: login service, names Studio gave, the
                                      proxy it started; asks before deleting the settings
  portless-studio service install     Start Studio when you log in
  portless-studio service uninstall   Stop starting Studio when you log in
  portless-studio service status      Say whether the login service is installed and running
  portless-studio config [--edit]     Print the config file, or open it in $EDITOR
  portless-studio doctor              Check portless, the proxy and Studio, and say how to fix
                                      what is wrong (exit code 1 when something fails)
  portless-studio list [--json]       List named routes and ports without a name, from the running
                                      Studio (or read directly when it is not running)
  portless-studio mcp                 Run an MCP server on stdio so AI agents can list, name and
                                      stop dev servers through the running Studio (docs/mcp.md)
  portless-studio run [--name <name>] [--cwd <dir>] -- <command...>
                                      Run a command in a Studio terminal, name the port it
                                      opens and print its output here until Ctrl+C, which stops
                                      it (docs/terminals.md)
  portless-studio open [target]       Bring Studio to the front showing a route, project,
                                      terminal id or port:<n>

Options:
  --port <n>       Port for the dashboard, on 127.0.0.1 (default from the config, ${DEFAULT_PORT};
                   0 picks a free one)
  --no-open        Do not open the browser
  --no-register    Do not register the "studio" portless alias for the dashboard
  -y, --yes        With init and uninstall: accept every default without asking
  --json           With doctor, config and list: print JSON for scripts and agents
  --name <name>    With run: name for the port the command opens (default: the suggested one)
  --cwd <dir>      With run: folder to run in (default: the current folder)
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  PORTLESS_STATE_DIR   portless state directory (default ~/.portless)
  PORTLESS_BIN         portless binary used to create and remove aliases (default: portless)
  EDITOR               Editor that \`config --edit\` opens
  PORTLESS_STUDIO_URL  Studio that \`mcp\`, \`list\`, \`run\` and \`open\` talk to
                       (default http://127.0.0.1:<port>)
`;

const SUBCOMMANDS = new Set([
  "init",
  "uninstall",
  "service",
  "config",
  "doctor",
  "list",
  "mcp",
  "run",
  "open",
]);
const SERVICE_ACTIONS = new Set<string>(["install", "uninstall", "status"]);

/** Turns command-line arguments into options, or a message saying what is wrong with them. */
export function parseCliArgs(argv: string[]): Result<CliOptions, string> {
  const first = argv[0];
  const subcommand = first !== undefined && !first.startsWith("-") ? first : null;
  if (subcommand !== null && !SUBCOMMANDS.has(subcommand)) {
    return err(`Unknown command "${subcommand}".`);
  }
  const rest = subcommand === null ? argv : argv.slice(1);

  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(rest, subcommand);
  } catch (error) {
    return err((error as Error).message);
  }
  const { values, positionals } = parsed;

  if (values.help) return ok({ command: "help" });
  if (values.version) return ok({ command: "version" });

  if (subcommand === "init") return ok({ command: "init", yes: values.yes === true });
  if (subcommand === "uninstall") return ok({ command: "uninstall", yes: values.yes === true });
  const json = values.json === true;
  if (subcommand === "config") {
    if (values.edit && json) return err("Use either --edit or --json, not both.");
    return ok({ command: "config", edit: values.edit === true, json });
  }
  if (subcommand === "doctor") return ok({ command: "doctor", json });
  if (subcommand === "list") return ok({ command: "list", json });
  if (subcommand === "mcp") return ok({ command: "mcp" });
  if (subcommand === "run") {
    if (positionals.length === 0) {
      return err('Give the command to run after "--", e.g. portless-studio run -- pnpm dev');
    }
    if (values.name !== undefined && values.name.trim() === "") return err("--name needs a name.");
    return ok({
      command: "run",
      cwd: values.cwd ?? null,
      name: values.name?.trim() ?? null,
      argv: positionals,
    });
  }
  if (subcommand === "open") {
    if (positionals.length > 1) return err('Give one target to "open", e.g. web.myapp or t2.');
    return ok({ command: "open", target: positionals[0] ?? null });
  }
  if (subcommand === "service") {
    const action = positionals[0];
    if (action === undefined || !SERVICE_ACTIONS.has(action) || positionals.length > 1) {
      return err('Use "service install", "service uninstall" or "service status".');
    }
    return ok({ command: "service", action: action as ServiceAction });
  }

  const overrides: StartOverrides = {};
  if (values.port !== undefined) {
    const port = values.port.trim() === "0" ? ok(0) : parsePort(values.port);
    if (!port.ok) return err(`Invalid --port "${values.port}": use a number from 0 to 65535.`);
    overrides.port = port.value;
  }
  if (values.open !== undefined) overrides.open = values.open;
  if (values.register !== undefined) overrides.register = values.register;
  return ok({ command: "start", overrides });
}

/** Settings for starting the server: the config, with any flag taking its place. */
export function resolveStartSettings(
  overrides: StartOverrides,
  config: StudioConfig,
): StartSettings {
  return {
    port: overrides.port ?? config.port,
    open: overrides.open ?? config.openBrowser,
    register: overrides.register ?? config.registerStudioAlias,
  };
}

/** Each subcommand accepts only its own flags, so a typo fails instead of being ignored. */
function parseFlags(args: string[], subcommand: string | null) {
  const common = {
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  } as const;
  const json = { type: "boolean" } as const;
  const options: ParseArgsOptionsConfig =
    subcommand === "init" || subcommand === "uninstall"
      ? { ...common, yes: { type: "boolean", short: "y" } }
      : subcommand === "config"
        ? { ...common, edit: { type: "boolean" }, json }
        : subcommand === "doctor" || subcommand === "list"
          ? { ...common, json }
          : subcommand === "service" || subcommand === "mcp" || subcommand === "open"
            ? common
            : subcommand === "run"
              ? { ...common, name: { type: "string" }, cwd: { type: "string" } }
              : {
                  ...common,
                  port: { type: "string" },
                  open: { type: "boolean" },
                  register: { type: "boolean" },
                };
  // parseArgs learned `allowNegative` in Node 22.4; reading `--no-<flag>` here keeps every Node 22.
  const { args: positive, negated } = splitNegations(args, options);
  const { values, positionals, tokens } = parseArgs({
    args: positive,
    options,
    tokens: true,
    allowPositionals: subcommand === "service" || subcommand === "run" || subcommand === "open",
  });
  for (const token of tokens) {
    if (token.kind === "option" && options[token.name]?.type === "boolean") {
      (values as Record<string, unknown>)[token.name] = !negated.has(token.index);
    }
  }
  return {
    positionals,
    values: values as {
      help?: boolean;
      version?: boolean;
      yes?: boolean;
      edit?: boolean;
      json?: boolean;
      port?: string;
      open?: boolean;
      register?: boolean;
      name?: string;
      cwd?: string;
    },
  };
}

/**
 * Turns each `--no-<flag>` of a boolean option into `--<flag>` and remembers its position, so the
 * last of `--open` and `--no-open` wins. Arguments after `--` are left alone.
 */
function splitNegations(
  args: string[],
  options: ParseArgsOptionsConfig,
): { args: string[]; negated: Set<number> } {
  const negated = new Set<number>();
  const end = args.indexOf("--");
  const positive = args.map((arg, index) => {
    if (end !== -1 && index > end) return arg;
    const match = /^--no-([^=]+)(=.*)?$/.exec(arg);
    const name = match?.[1];
    if (name === undefined || options[name]?.type !== "boolean") return arg;
    negated.add(index);
    return `--${name}${match?.[2] ?? ""}`;
  });
  return { args: positive, negated };
}
