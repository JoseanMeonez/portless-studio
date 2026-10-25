import type { Result } from "../core/result.ts";
import {
  type EnvRoute,
  envEntries,
  formatEnvLine,
  selectEnvRoutes,
} from "../core/routes/env-lines.ts";
import type { StudioClientError } from "./mcp/studio-client.ts";

export type EnvCommandOptions = {
  json: boolean;
  direct: boolean;
  prefix: string | null;
  strip: string | null;
  /** Route names to keep; `acme` also keeps every `*.acme` route. Empty keeps all. */
  names: string[];
  /** stdout: only the lines, so `>> .env.local` gets nothing else. */
  print: (line: string) => void;
  printError: (line: string) => void;
  readFromStudio: () => Promise<Result<EnvRoute[], StudioClientError>>;
  /** Reads portless directly, for when Studio is not running. */
  readLocally: () => Promise<EnvRoute[]>;
};

/** `portless-studio env`: `KEY=url` lines for a `.env` file, one per named route. */
export async function runEnvCommand(options: EnvCommandOptions): Promise<number> {
  const fromStudio = await options.readFromStudio();
  const routes = fromStudio.ok ? fromStudio.value : await options.readLocally();

  const selected = selectEnvRoutes(routes, options.names);
  if (!selected.ok) return fail(options, selected.error);
  const entries = envEntries(selected.value, {
    direct: options.direct,
    ...(options.prefix === null ? {} : { prefix: options.prefix }),
    ...(options.strip === null ? {} : { strip: options.strip }),
  });
  if (!entries.ok) return fail(options, entries.error);

  if (options.json) {
    const source = fromStudio.ok ? "studio" : "local";
    options.print(JSON.stringify({ source, variables: entries.value }, null, 2));
    return 0;
  }
  if (!fromStudio.ok) {
    options.printError("(Studio is not running: read directly from portless.)");
  }
  if (entries.value.length === 0) {
    options.printError("No named routes yet.");
    return 0;
  }
  options.print(entries.value.map(formatEnvLine).join("\n"));
  return 0;
}

function fail(options: EnvCommandOptions, message: string): number {
  options.printError(`Error: ${message}`);
  return 1;
}
