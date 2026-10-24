import * as fs from "node:fs";
import { execute } from "../portless/portless-cli.ts";

/** What the port scanners read from the machine. Tests replace it with fixtures. */
export type SystemIo = {
  /** File contents, or null when the file is missing or unreadable. */
  readFile(path: string): string | null;
  /** Entry names, or an empty list when the folder is missing or unreadable. */
  readDir(path: string): string[];
  /** Symlink target, or null when it is not a link or cannot be read. */
  readLink(path: string): string | null;
  /** Runs a system command; `stdout` is empty when it could not start. */
  run(bin: string, args: string[]): Promise<{ exitCode: number | null; stdout: string }>;
};

/** System commands like lsof answer in well under a second; a hung one should not block a scan. */
const COMMAND_TIMEOUT_MS = 5000;

export const nodeSystemIo: SystemIo = {
  readFile: (path) => {
    try {
      return fs.readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  readDir: (path) => {
    try {
      return fs.readdirSync(path);
    } catch {
      return [];
    }
  },
  readLink: (path) => {
    try {
      return fs.readlinkSync(path);
    } catch {
      return null;
    }
  },
  run: async (bin, args) => {
    const outcome = await execute(bin, args, { timeoutMs: COMMAND_TIMEOUT_MS });
    return { exitCode: outcome.exitCode, stdout: outcome.missing ? "" : outcome.stdout };
  },
};
