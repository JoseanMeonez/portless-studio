import { spawn } from "node:child_process";
import { err, ok, type Result } from "../../../core/result.ts";
import { type AppError, appError } from "../../application/app-error.ts";
import type { AppLauncher, LaunchCommand } from "../../application/open-with.ts";

type DetachedChild = {
  once(event: "spawn", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
};

/** The part of `child_process.spawn` the launcher uses; tests pass a fake. */
export type SpawnDetached = (
  command: string,
  args: readonly string[],
  options: {
    detached: boolean;
    stdio: "ignore";
    windowsHide: boolean;
    windowsVerbatimArguments: boolean;
  },
) => DetachedChild;

export type DetachedLauncherOptions = {
  platform: NodeJS.Platform;
  spawn?: SpawnDetached;
  /** cmd.exe for `.cmd` shims on Windows; `ComSpec` by default. */
  comSpec?: string;
};

// Inside double quotes cmd.exe still expands %VAR% and cannot escape a quote.
const CMD_UNSAFE = /["%\r\n]/;

/**
 * Starts editors and the file manager detached, with stdio closed, so they outlive Studio and
 * never write into its output. No shell is involved, except cmd.exe for the `.cmd` shims
 * editors install on Windows, where every word is quoted and unsafe characters are refused.
 */
export function createDetachedLauncher(options: DetachedLauncherOptions): AppLauncher {
  const start = options.spawn ?? (spawn as unknown as SpawnDetached);
  const windows = options.platform === "win32";
  return {
    launch: (command) => {
      const prepared = windows ? forWindows(command, options.comSpec) : ok(plain(command));
      if (!prepared.ok) return Promise.resolve(prepared);
      const { file, args, verbatim, hidden } = prepared.value;
      return new Promise<Result<void, AppError>>((resolve) => {
        const failed = (error: Error) =>
          resolve(
            err(appError("command_failed", `Could not start ${command.file}: ${error.message}`)),
          );
        try {
          const child = start(file, args, {
            detached: true,
            stdio: "ignore",
            // Hiding would hide an editor's own window too; only cmd.exe's console is hidden.
            windowsHide: hidden,
            windowsVerbatimArguments: verbatim,
          });
          child.once("error", failed);
          child.once("spawn", () => {
            child.unref();
            resolve(ok(undefined));
          });
        } catch (error) {
          failed(error as Error);
        }
      });
    },
  };
}

type Prepared = { file: string; args: string[]; verbatim: boolean; hidden: boolean };

function plain(command: LaunchCommand): Prepared {
  return { file: command.file, args: command.args, verbatim: false, hidden: false };
}

function forWindows(
  command: LaunchCommand,
  comSpec: string | undefined,
): Result<Prepared, AppError> {
  if (!/\.(cmd|bat)$/i.test(command.file)) {
    return ok({ ...plain(command), verbatim: command.windowsVerbatim === true });
  }
  const words = [command.file, ...command.args];
  if (words.some((word) => CMD_UNSAFE.test(word))) {
    return err(
      appError("command_failed", `Could not start ${command.file}: the folder has a " or % in it.`),
    );
  }
  // `/s` drops the outer quotes, leaving each word quoted for cmd.exe.
  const line = `"${words.map((word) => `"${word}"`).join(" ")}"`;
  return ok({
    file: comSpec ?? process.env.ComSpec ?? "cmd.exe",
    args: ["/d", "/s", "/c", line],
    verbatim: true,
    hidden: true,
  });
}
