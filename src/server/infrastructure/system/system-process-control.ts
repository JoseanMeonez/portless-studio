import { err, ok, type Result } from "../../../core/result.ts";
import { type AppError, appError } from "../../application/app-error.ts";
import type { ProcessControl, ProcessOwner } from "../../application/process-control.ts";
import { isProcessAlive } from "../portless/state-files.ts";
import type { SystemIo } from "./system-io.ts";

/** How long a dev server gets to shut down cleanly before it is forced. */
const GRACE_MS = 5000;
const POLL_MS = 100;

export type SystemProcessControlOptions = {
  platform: NodeJS.Platform;
  io: SystemIo;
  /** The uid Studio runs as; null on Windows. */
  uid: number | null;
  /** The user name Studio runs as, compared with tasklist's on Windows. */
  userName: string;
  graceMs?: number;
  pollMs?: number;
  /** Whether a pid still runs; tests replace it. */
  isAlive?: (pid: number) => boolean;
};

/** What a `taskkill` run says happened, read from its exit code and English output. */
export type TaskkillAnswer = "sent" | "forcefully-only" | "access-denied" | "not-found" | "failed";

export function parseTaskkill(exitCode: number | null, output: string): TaskkillAnswer {
  if (/access is denied/i.test(output)) return "access-denied";
  if (/terminated forcefully/i.test(output)) return "forcefully-only";
  if (exitCode === 128 || /not found/i.test(output)) return "not-found";
  return exitCode === 0 ? "sent" : "failed";
}

/** `Uid:` in `/proc/<pid>/status` lists real, effective, saved and filesystem uids; take the real one. */
export function parseProcStatusUid(text: string): number | null {
  const match = /^Uid:\s+(\d+)/m.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

/** The "User Name" column (the 7th) of `tasklist /v /fo csv /nh`. */
export function parseTasklistUser(text: string): string | null {
  const line = text.split(/\r?\n/).find((row) => row.startsWith('"'));
  if (!line) return null;
  const columns = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
  const user = columns[6];
  return user && user !== "N/A" ? user : null;
}

export function ownerFromUid(uid: number | null, current: number | null): ProcessOwner {
  if (uid === null) return "unknown";
  if (uid === 0) return "root";
  return uid === current ? "you" : "other";
}

/** Processes on this machine: who owns them, and stopping them gracefully. */
export class SystemProcessControl implements ProcessControl {
  readonly #options: SystemProcessControlOptions;

  constructor(options: SystemProcessControlOptions) {
    this.#options = options;
  }

  async ownerOf(pid: number): Promise<ProcessOwner> {
    const { platform, io, uid, userName } = this.#options;
    if (platform === "win32") {
      const listed = await io.run("tasklist", ["/v", "/fo", "csv", "/nh", "/fi", `PID eq ${pid}`]);
      const user = parseTasklistUser(listed.stdout);
      if (user === null) return "unknown";
      const name = user.split("\\").pop()?.toLowerCase();
      return name === userName.toLowerCase() ? "you" : "other";
    }
    if (platform === "darwin") {
      const listed = await io.run("ps", ["-o", "uid=", "-p", String(pid)]);
      const value = Number.parseInt(listed.stdout.trim(), 10);
      return ownerFromUid(Number.isInteger(value) ? value : null, uid);
    }
    const status = io.readFile(`/proc/${pid}/status`);
    return ownerFromUid(status === null ? null : parseProcStatusUid(status), uid);
  }

  async terminate(pid: number): Promise<Result<void, AppError>> {
    const graceMs = this.#options.graceMs ?? GRACE_MS;
    if (this.#options.platform === "win32") return this.#taskkill(pid, graceMs);

    const sent = signal(pid, "SIGTERM");
    if (!sent.ok) return sent;
    if (await this.#exited(pid, graceMs)) return ok(undefined);
    const forced = signal(pid, "SIGKILL");
    if (!forced.ok) return forced;
    return (await this.#exited(pid, 1000)) ? ok(undefined) : stillRunning(pid);
  }

  /**
   * Without /F, taskkill asks the process tree to close, like closing its window would. Console
   * programs such as node only stop with /F, and taskkill says so: then it forces at once.
   */
  async #taskkill(pid: number, graceMs: number): Promise<Result<void, AppError>> {
    const { io } = this.#options;
    const asked = await io.run("taskkill", ["/PID", String(pid), "/T"]);
    const answer = parseTaskkill(asked.exitCode, asked.output ?? asked.stdout);
    if (answer === "access-denied") return accessDenied(pid);
    if (answer === "not-found") return ok(undefined);
    if (answer !== "forcefully-only" && (await this.#exited(pid, graceMs))) return ok(undefined);

    const forced = await io.run("taskkill", ["/F", "/PID", String(pid), "/T"]);
    if (parseTaskkill(forced.exitCode, forced.output ?? forced.stdout) === "access-denied") {
      return accessDenied(pid);
    }
    return (await this.#exited(pid, 1000)) ? ok(undefined) : stillRunning(pid);
  }

  async #exited(pid: number, withinMs: number): Promise<boolean> {
    const pollMs = this.#options.pollMs ?? POLL_MS;
    const isAlive = this.#options.isAlive ?? isProcessAlive;
    const deadline = Date.now() + withinMs;
    while (Date.now() < deadline) {
      if (!isAlive(pid)) return true;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return !isAlive(pid);
  }
}

function signal(pid: number, name: NodeJS.Signals): Result<void, AppError> {
  try {
    process.kill(pid, name);
    return ok(undefined);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Already gone: that is what was asked for.
    if (code === "ESRCH") return ok(undefined);
    if (code === "EPERM") {
      return err(
        appError(
          "process_not_allowed",
          `Process ${pid} belongs to another user.`,
          `sudo kill ${pid}`,
        ),
      );
    }
    return err(appError("command_failed", `Could not signal process ${pid}: ${code ?? "unknown"}`));
  }
}

function accessDenied(pid: number): Result<void, AppError> {
  return err(
    appError(
      "process_not_allowed",
      `Process ${pid} belongs to another user or to Windows. Stop it from a terminal opened ` +
        "with Run as Administrator.",
      `taskkill /F /PID ${pid}`,
    ),
  );
}

function stillRunning(pid: number): Result<void, AppError> {
  return err(appError("command_failed", `Process ${pid} is still running after being forced.`));
}
