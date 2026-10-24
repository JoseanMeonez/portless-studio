import { spawn } from "node:child_process";

export type CommandResult = {
  /** null when the process could not start or was killed. */
  exitCode: number | null;
  /** stdout and stderr together; empty when the terminal was attached. */
  output: string;
  /** True when the command does not exist on this machine. */
  missing: boolean;
};

export type RunOptions = {
  /** Attach this terminal, so the command can ask for a password (sudo) or draw its own UI. */
  inherit?: boolean;
};

/** Runs a command and waits for it. Injected everywhere so tests never start real processes. */
export type CommandRunner = (
  command: string,
  args: string[],
  options?: RunOptions,
) => Promise<CommandResult>;

// cmd.exe exits with 9009 when the command it was asked to run does not exist.
const WINDOWS_COMMAND_NOT_FOUND = 9009;

export const runCommand: CommandRunner = (command, args, options = {}) => {
  // Windows installs portless and npm as `.cmd` shims, which only cmd.exe can start. Callers pass
  // fixed words, paths and validated names, so cmd.exe has nothing to interpret.
  const isWindows = process.platform === "win32";
  const file = isWindows ? (process.env.ComSpec ?? "cmd.exe") : command;
  const fileArgs = isWindows ? ["/d", "/s", "/c", command, ...args] : args;

  return new Promise((resolve) => {
    let output = "";
    const child = spawn(file, fileArgs, {
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: !options.inherit,
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ exitCode: null, output: error.message, missing: error.code === "ENOENT" });
    });
    child.on("close", (exitCode) => {
      const missing = isWindows && exitCode === WINDOWS_COMMAND_NOT_FOUND;
      resolve({ exitCode, output: output.trim(), missing });
    });
  });
};
