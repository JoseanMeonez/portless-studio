import { API_PATHS, type FocusResponse } from "../core/api/contract.ts";
import type { StudioClient } from "./mcp/studio-client.ts";
import { describeFocus } from "./mcp/studio-tools.ts";

/**
 * `portless-studio open [target]`: brings the Studio page to the front showing a route, a
 * project, a terminal or a port. Returns the exit code.
 */
export async function runOpenCommand(
  client: StudioClient,
  target: string | null,
  print: (line: string) => void,
  printError: (line: string) => void,
): Promise<number> {
  const result = await client.write("POST", API_PATHS.focus, target ? { target } : {});
  if (!result.ok) {
    printError(`Error: ${result.error.message}`);
    return 1;
  }
  print(describeFocus(result.value as FocusResponse));
  return 0;
}
