import type { DetectedPort } from "../core/ports/detected-port.ts";
import type { Result } from "../core/result.ts";
import type { ProxyStatus, Route } from "../core/routes/route.ts";
import type { StudioClientError } from "./mcp/studio-client.ts";
import { describeProxy, detectedItem, proxyItem, routeItem } from "./studio-items.ts";

export type ListData = { proxy: ProxyStatus; routes: Route[]; detected: DetectedPort[] };

export type ListCommandOptions = {
  json: boolean;
  print: (line: string) => void;
  /** The running Studio's snapshot, which carries health and project details. */
  readFromStudio: () => Promise<Result<ListData, StudioClientError>>;
  /** Reads portless and scans ports directly, for when Studio is not running. */
  readLocally: () => Promise<ListData>;
};

/** `portless-studio list [--json]`: named routes and the ports that have no name yet. */
export async function runListCommand(options: ListCommandOptions): Promise<number> {
  const fromStudio = await options.readFromStudio();
  const source = fromStudio.ok ? "studio" : "local";
  const data = fromStudio.ok ? fromStudio.value : await options.readLocally();

  if (options.json) {
    options.print(
      JSON.stringify(
        {
          source,
          proxy: proxyItem(data.proxy),
          routes: data.routes.map(routeItem),
          detected: data.detected.map(detectedItem),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  const routes = data.routes.map(routeItem);
  const lines = [`Routes (${routes.length}), ${describeProxy(data.proxy)}`];
  lines.push(
    ...columns(
      routes.map((route) => [
        route.name,
        route.url,
        String(route.port),
        route.health,
        route.project === null ? "" : [route.project, route.worktree].filter(Boolean).join("/"),
      ]),
    ),
  );
  const detected = data.detected.map(detectedItem);
  lines.push("", `Ports without a name (${detected.length})`);
  lines.push(
    ...columns(
      detected.map((port) => [
        String(port.port),
        port.process,
        port.folder ?? "-",
        port.suggestedName === null ? "no suggestion" : `suggested: ${port.suggestedName}`,
      ]),
    ),
  );
  if (!fromStudio.ok) {
    lines.push("", "(Studio is not running: read directly from portless and this machine.)");
  }
  options.print(lines.join("\n"));
  return 0;
}

/** Pads each column to its widest cell, indented two spaces. */
function columns(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.length);
    });
  }
  return rows.map(
    (row) =>
      `  ${row
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join("  ")
        .trimEnd()}`,
  );
}
