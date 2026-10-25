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
  /** Raw OS listeners, including ports that stopped answering HTTP. */
  listeners?: () => Promise<{ pid: number | null; port: number }[]>;
  refresh?: () => Promise<void>;
  portClosed?: (port: number) => Promise<boolean>;
  settleMs?: number;
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
  all = false,
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
  const targets = all ? await deps.processes.devTree?.(pid) : [pid];
  if (!targets?.length) {
    return err(
      appError(
        "unsupported",
        "Could not identify the development command tree. Stop it from its terminal.",
      ),
    );
  }
  // Check the entire plan before sending any signal. A tree must never include Studio.
  for (const target of targets) {
    if (target === deps.selfPid || (await deps.processes.ownerOf(target)) !== "you") {
      return err(
        appError(
          "process_not_allowed",
          "The development command tree includes a protected process. Stop it from its terminal.",
        ),
      );
    }
  }
  const watchedPorts = new Set([port]);
  for (const listener of (await deps.listeners?.()) ?? []) {
    if (listener.pid !== null && targets.includes(listener.pid)) watchedPorts.add(listener.port);
  }
  try {
    for (const target of targets) {
      const stopped = await deps.processes.terminate(target);
      if (!stopped.ok) return stopped;
    }
    if (deps.listeners || deps.portClosed) {
      // Observe a settling window too: a supervisor may immediately restart the listener.
      await new Promise((resolve) => setTimeout(resolve, deps.settleMs ?? 750));
      const listeners = (await deps.listeners?.()) ?? [];
      for (const watchedPort of watchedPorts) {
        const survivor = listeners.find((item) => item.port === watchedPort);
        const closed = deps.portClosed ? await deps.portClosed(watchedPort) : !survivor;
        if (!closed) {
          const reason = !survivor
            ? "The port could not be confirmed closed"
            : targets.includes(survivor.pid ?? -1)
              ? `Process ${survivor.pid} is still listening`
              : `Process ${survivor.pid ?? "unknown"} is now listening; a parent or another program may have restarted the server`;
          return err(
            appError(
              "port_in_use",
              `Port ${watchedPort} did not stay closed. ${reason}. Try Stop all to stop the development command, or stop it from its terminal.`,
            ),
          );
        }
      }
    }
    return ok({ pid, port });
  } finally {
    await deps.refresh?.();
  }
}
