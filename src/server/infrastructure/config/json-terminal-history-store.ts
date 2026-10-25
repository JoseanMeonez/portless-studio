import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseTerminalHistory,
  type TerminalHistory,
} from "../../../core/terminals/terminal-history.ts";
import type { TerminalHistoryStore } from "../../application/terminals.ts";
import { writeFileAtomic } from "./atomic-write.ts";

const FILE_NAME = "terminals.json";

/** `terminals.json` in the config file's folder. */
export function terminalHistoryPathFor(configPath: string): string {
  return path.join(path.dirname(configPath), FILE_NAME);
}

/**
 * The terminals running when Studio stopped and the recent commands per folder, as
 * `{ "running": [...], "recentCommands": { "<folder>": [...] } }`. Studio writes it on its own.
 */
export class JsonTerminalHistoryStore implements TerminalHistoryStore {
  readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  read(): TerminalHistory {
    try {
      return parseTerminalHistory(JSON.parse(fs.readFileSync(this.path, "utf8")));
    } catch {
      return parseTerminalHistory(null);
    }
  }

  write(history: TerminalHistory): void {
    writeFileAtomic(this.path, `${JSON.stringify(history, null, 2)}\n`);
  }
}
