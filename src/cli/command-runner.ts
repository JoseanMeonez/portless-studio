import { runProcess } from "../server/infrastructure/system/process-runner.ts";

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

/** The server's process runner, so Windows quoting and UTF-8 output work the same in the CLI. */
export const runCommand: CommandRunner = async (command, args, options = {}) => {
  const outcome = await runProcess(command, args, { inherit: options.inherit === true });
  return {
    exitCode: outcome.exitCode,
    output: outcome.error ?? outcome.combined.trim(),
    missing: outcome.missing,
  };
};
