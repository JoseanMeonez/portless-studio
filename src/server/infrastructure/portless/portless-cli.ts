import type { InstallPortlessResponse, PortlessInstallation } from "../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../core/result.ts";
import { type AppError, appError } from "../../application/app-error.ts";
import { runProcess } from "../system/process-runner.ts";

/** `portless alias` waits up to 15 s for its file lock; give it a little more. */
const TIMEOUT_MS = 20_000;
/** A global npm install downloads the package and its dependencies; slow networks need minutes. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;
/** The UI shows the end of npm's output, where the result and any error are. */
const MAX_OUTPUT_CHARS = 8 * 1024;
// Fixed arguments: nothing from the request reaches this command line.
const INSTALL_ARGS = ["install", "-g", "portless"];
// Colors plus the cursor and line codes npm uses to draw its progress spinner.
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
const VERSION = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;

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

/**
 * `portless proxy start` on the given port. stdin is closed, so a port that would need sudo fails
 * instead of waiting for a password nobody can type.
 */
export function startProxy(
  cli: PortlessCli,
  port: number,
  https: boolean,
): Promise<Result<void, AppError>> {
  return run(cli, ["proxy", "start", "--port", String(port), https ? "--https" : "--no-tls"]);
}

/** `portless proxy stop`; a proxy started with sudo makes it fail instead of asking. */
export function stopProxy(cli: PortlessCli): Promise<Result<void, AppError>> {
  return run(cli, ["proxy", "stop"]);
}

/** Runs `portless --version`; a binary that cannot start counts as not installed. */
export async function detectPortless(cli: PortlessCli): Promise<PortlessInstallation> {
  const outcome = await execute(cli.bin, ["--version"], { stateDir: cli.stateDir });
  if (outcome.missing || outcome.exitCode !== 0) return { installed: false, version: null };
  return { installed: true, version: parsePortlessVersion(outcome.stdout || outcome.combined) };
}

/** The semver in `portless --version` output, or its first line when it has none. */
export function parsePortlessVersion(output: string): string | null {
  const text = stripAnsi(output);
  const match = VERSION.exec(text);
  if (match?.[1]) return match[1];
  const firstLine = text.split(/\r?\n/).find((line) => line.trim() !== "");
  return firstLine ? firstLine.trim().slice(0, 64) : null;
}

/** Runs `npm install -g portless`; `npmBin` is configurable so tests never touch the real npm. */
export async function installPortless(
  npmBin: string,
  stateDir: string,
): Promise<Result<Omit<InstallPortlessResponse, "version">, AppError>> {
  const outcome = await execute(npmBin, INSTALL_ARGS, { stateDir, timeoutMs: INSTALL_TIMEOUT_MS });
  const output = lastChars(stripAnsi(outcome.combined).trim(), MAX_OUTPUT_CHARS);
  if (outcome.missing) {
    return err(
      appError("install_failed", `Could not run "${npmBin}". Install Node.js, which includes npm.`),
    );
  }
  if (outcome.exitCode === 0) return ok({ output });
  const reason =
    outcome.exitCode === null
      ? "npm did not finish in 5 minutes."
      : `npm exited with code ${outcome.exitCode}.`;
  return err(appError("install_failed", output === "" ? reason : `${reason}\n\n${output}`));
}

export type Outcome = {
  exitCode: number | null;
  /** stderr when it has text, otherwise stdout: where portless puts its messages. */
  output: string;
  stdout: string;
  /** stdout and stderr in the order they arrived. */
  combined: string;
  missing: boolean;
};

/** `stateDir` reaches the child as `PORTLESS_STATE_DIR`; commands unrelated to portless omit it. */
export type ExecuteOptions = { stateDir?: string; timeoutMs?: number };

async function run(cli: PortlessCli, args: string[]): Promise<Result<void, AppError>> {
  const outcome = await execute(cli.bin, args, { stateDir: cli.stateDir });
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
    stripAnsi(output)
      .trim()
      .replace(/^Error:\s*/i, "") || "portless failed without a message.";
  if (/already registered|is a static alias/i.test(message)) return appError("name_taken", message);
  if (/no alias found/i.test(message)) return appError("not_found", message);
  return appError("internal", message);
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, "");
}

function lastChars(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(-max)}`;
}

/** Runs portless, npm and the scanners' system commands through the shared process runner. */
export async function execute(
  bin: string,
  args: string[],
  options: ExecuteOptions = {},
): Promise<Outcome> {
  const outcome = await runProcess(bin, args, {
    env: {
      ...process.env,
      ...(options.stateDir === undefined ? {} : { PORTLESS_STATE_DIR: options.stateDir }),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
  });
  const output = outcome.error ?? (outcome.stderr.trim() === "" ? outcome.stdout : outcome.stderr);
  return {
    exitCode: outcome.exitCode,
    output,
    stdout: outcome.stdout,
    combined: outcome.combined,
    missing: outcome.missing,
  };
}
