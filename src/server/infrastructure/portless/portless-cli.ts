import { spawn } from "node:child_process";
import { err, ok, type Result } from "../../../core/result.ts";
import { type AppError, appError } from "../../application/app-error.ts";

/** `portless alias` waits up to 15 s for its file lock; give it a little more. */
const TIMEOUT_MS = 20_000;
// cmd.exe exits with 9009 when the command it was asked to run does not exist.
const WINDOWS_COMMAND_NOT_FOUND = 9009;
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export type PortlessCli = {
  /** Path or command name of the portless binary. */
  bin: string;
  stateDir: string;
};

export function addAlias(
  cli: PortlessCli,
  name: string,
  port: number,
  force: boolean,
): Promise<Result<void, AppError>> {
  const args = ["alias", name, String(port)];
  if (force) args.push("--force");
  return run(cli, args);
}

export function removeAlias(cli: PortlessCli, name: string): Promise<Result<void, AppError>> {
  return run(cli, ["alias", "--remove", name]);
}

type Outcome = { exitCode: number | null; output: string; missing: boolean };

async function run(cli: PortlessCli, args: string[]): Promise<Result<void, AppError>> {
  const outcome = await execute(cli, args);
  if (outcome.missing) {
    return err(
      appError("portless_unavailable", `Could not run "${cli.bin}". Is portless installed?`),
    );
  }
  if (outcome.exitCode === 0) return ok(undefined);
  return err(toError(outcome.output));
}

/** Maps the messages `portless alias` prints on failure to API error codes. */
function toError(output: string): AppError {
  const message =
    output
      .replace(ANSI_ESCAPE, "")
      .trim()
      .replace(/^Error:\s*/i, "") || "portless failed without a message.";
  if (/already registered|is a static alias/i.test(message)) return appError("name_taken", message);
  if (/no alias found/i.test(message)) return appError("not_found", message);
  return appError("internal", message);
}

function execute(cli: PortlessCli, args: string[]): Promise<Outcome> {
  // Windows installs portless as a `.cmd` shim, which only cmd.exe can start. Arguments are
  // validated names and numbers, so cmd.exe has nothing to interpret.
  const isWindows = process.platform === "win32";
  const command = isWindows ? (process.env.ComSpec ?? "cmd.exe") : cli.bin;
  const commandArgs = isWindows ? ["/d", "/s", "/c", cli.bin, ...args] : args;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, commandArgs, {
      env: { ...process.env, PORTLESS_STATE_DIR: cli.stateDir, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      windowsHide: true,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ exitCode: null, output: error.message, missing: error.code === "ENOENT" });
    });
    child.on("close", (exitCode) => {
      const output = stderr.trim() === "" ? stdout : stderr;
      resolve({ exitCode, output, missing: isWindows && exitCode === WINDOWS_COMMAND_NOT_FOUND });
    });
  });
}
