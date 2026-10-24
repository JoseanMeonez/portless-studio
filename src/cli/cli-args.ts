import { parseArgs } from "node:util";
import { err, ok, type Result } from "../core/result.ts";
import { parsePort } from "../core/routes/route-name.ts";

export const DEFAULT_PORT = 4949;

export type CliOptions =
  | { command: "help" }
  | { command: "version" }
  | { command: "start"; port: number; open: boolean; register: boolean };

export const HELP = `portless-studio: a local web dashboard for portless routes

Usage:
  portless-studio [options]

Options:
  --port <n>       Port for the dashboard, on 127.0.0.1 (default ${DEFAULT_PORT}, 0 picks a free one)
  --no-open        Do not open the browser
  --no-register    Do not register the "studio" portless alias for the dashboard
  -h, --help       Show this help
  -v, --version    Show the version

Environment:
  PORTLESS_STATE_DIR   portless state directory (default ~/.portless)
  PORTLESS_BIN         portless binary used to create and remove aliases (default: portless)
`;

/** Turns command-line arguments into options, or a message saying what is wrong with them. */
export function parseCliArgs(argv: string[]): Result<CliOptions, string> {
  let values: {
    port?: string;
    open?: boolean;
    register?: boolean;
    help?: boolean;
    version?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      allowNegative: true,
      options: {
        port: { type: "string" },
        open: { type: "boolean", default: true },
        register: { type: "boolean", default: true },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    }));
  } catch (error) {
    return err((error as Error).message);
  }

  if (values.help) return ok({ command: "help" });
  if (values.version) return ok({ command: "version" });

  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    const parsed = values.port.trim() === "0" ? ok(0) : parsePort(values.port);
    if (!parsed.ok) return err(`Invalid --port "${values.port}": use a number from 0 to 65535.`);
    port = parsed.value;
  }
  return ok({
    command: "start",
    port,
    open: values.open !== false,
    register: values.register !== false,
  });
}
