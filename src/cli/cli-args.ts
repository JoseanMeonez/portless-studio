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
  | { command: "service"; action: ServiceAction }
  | { command: "config"; edit: boolean }
  | { command: "doctor" };

export type StartSettings = { port: number; open: boolean; register: boolean };

export const HELP = `portless-studio: a local web dashboard for portless routes

Usage:
  portless-studio [options]           Start Studio
  portless-studio init [--yes]        Set everything up: portless, settings, names, proxy
  portless-studio service install     Start Studio when you log in
  portless-studio service uninstall   Stop starting Studio when you log in
  portless-studio service status      Say whether the login service is installed and running
  portless-studio config [--edit]     Print the config file, or open it in $EDITOR
  portless-studio doctor              Check portless, the proxy and Studio, and say how to fix
                                      what is wrong (exit code 1 when something fails)

Options:
  --port <n>       Port for the dashboard, on 127.0.0.1 (default from the config, ${DEFAULT_PORT};
                   0 picks a free one)
  --no-open        Do not open the browser
  --no-register    Do not register the "studio" portless alias for the dashboard
  -y, --yes        With init: accept every default without asking
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  PORTLESS_STATE_DIR   portless state directory (default ~/.portless)
  PORTLESS_BIN         portless binary used to create and remove aliases (default: portless)
  EDITOR               Editor that \`config --edit\` opens
`;

const SUBCOMMANDS = new Set(["init", "service", "config", "doctor"]);
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
  if (subcommand === "config") return ok({ command: "config", edit: values.edit === true });
  if (subcommand === "doctor") return ok({ command: "doctor" });
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
  const options: ParseArgsOptionsConfig =
    subcommand === "init"
      ? { ...common, yes: { type: "boolean", short: "y" } }
      : subcommand === "config"
        ? { ...common, edit: { type: "boolean" } }
        : subcommand === "service" || subcommand === "doctor"
          ? common
          : {
              ...common,
              port: { type: "string" },
              open: { type: "boolean" },
              register: { type: "boolean" },
            };
  const { values, positionals } = parseArgs({
    args,
    options,
    allowNegative: true,
    allowPositionals: subcommand === "service",
  });
  return {
    positionals,
    values: values as {
      help?: boolean;
      version?: boolean;
      yes?: boolean;
      edit?: boolean;
      port?: string;
      open?: boolean;
      register?: boolean;
    },
  };
}
