import { killCommand } from "../../core/doctor/platform-commands.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { type AppError, appError } from "./app-error.ts";
import type { ProcessControl } from "./process-control.ts";

export type StopProcessDeps = {
  processes: ProcessControl;
  /** pid -> port of processes listening on a detected or routed port, from a fresh scan. */
  stoppablePids: () => Promise<Map<number, number>>;
  /** Studio's own pid, never stopped from its own page. */
  selfPid: number;
  /** The system the command to copy is written for; defaults to this one. */
  platform?: string;
};

/**
 * Stops a dev server from its row. Only a process of the current user that listens on a port the
 * UI shows can be stopped, so the endpoint cannot be used to kill anything else on the machine.
 */
export async function stopProcess(
  input: string,
  deps: StopProcessDeps,
): Promise<Result<{ pid: number; port: number }, AppError>> {
  if (!/^\d+$/.test(input) || Number(input) < 1) {
    return err(appError("invalid_request", "The pid must be a whole number above 0."));
  }
  const pid = Number(input);
  const port = (await deps.stoppablePids()).get(pid);
  if (port === undefined || pid === deps.selfPid) {
    return err(
      appError("process_not_allowed", `Process ${pid} does not serve a port Studio shows.`),
    );
  }
  const owner = await deps.processes.ownerOf(pid);
  if (owner !== "you") {
    const who = owner === "root" ? "root" : owner === "other" ? "another user" : "an unknown user";
    return err(
      appError(
        "process_not_allowed",
        `Process ${pid} on port ${port} belongs to ${who}; stop it from a terminal.`,
        killCommand(deps.platform ?? process.platform, [pid], true),
      ),
    );
  }
  const stopped = await deps.processes.terminate(pid);
  return stopped.ok ? ok({ pid, port }) : stopped;
}
