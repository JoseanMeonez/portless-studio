import * as fs from "node:fs";
import type { ConfigStore } from "../server/application/config-store.ts";
import type { CommandRunner } from "./command-runner.ts";

/** `portless-studio config`: where the file is and what Studio reads from it. */
export async function printConfig(store: ConfigStore, print: (line: string) => void) {
  print(`Config file: ${store.path}`);
  const read = await store.read();
  if (!read.ok) {
    print(`The file has a problem: ${read.error.message}`);
    return;
  }
  print(JSON.stringify(read.value, null, 2));
  if (!fs.existsSync(store.path)) print("(The file is not created yet; these are the defaults.)");
}

/**
 * `portless-studio config --edit`: opens the file in `editor` (`$EDITOR`, which may carry flags
 * such as `code -w`). The file is created with the current values first so there is something to
 * edit. Without an editor it prints the path.
 */
export async function editConfig(
  store: ConfigStore,
  editor: string | undefined,
  run: CommandRunner,
  print: (line: string) => void,
) {
  if (!fs.existsSync(store.path)) {
    const read = await store.read();
    if (read.ok) await store.write(read.value);
  }
  const [command, ...flags] = (editor ?? "").trim().split(/\s+/).filter(Boolean);
  if (command === undefined) {
    print(`Set $EDITOR to open it from here, or edit it directly: ${store.path}`);
    return;
  }
  const result = await run(command, [...flags, store.path], { inherit: true });
  if (result.exitCode !== 0) print(`${command} did not open the file. Edit it at: ${store.path}`);
  else print("Saved changes reach a running Studio without a restart.");
}
