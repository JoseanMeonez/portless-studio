import type { StudioAction } from "../../core/api/contract.ts";
import type { Result } from "../../core/result.ts";
import type { AppError } from "./app-error.ts";

/** Whether Studio is set to start at login (systemd, launchd or the Startup folder). */
export type LoginServiceState = { installed: boolean; running: boolean };

/** A checked restart or stop, ready to run once the HTTP answer has gone out. */
export type PreparedStudioAction = {
  message: string;
  /** How to start Studio again after a stop, shown on the page's last screen. */
  startCommand: string;
  run: () => Promise<void>;
};

/**
 * Restarts or stops Studio itself. The CLI implements it, because it knows whether Studio runs as
 * a login service; the server only exposes it.
 */
export interface StudioServiceControl {
  /** Null when it cannot be known, e.g. when Studio runs from its TypeScript source. */
  status(): Promise<LoginServiceState | null>;
  /** Checks the action can run; the returned `run` ends or replaces this process. */
  prepare(action: StudioAction): Promise<Result<PreparedStudioAction, AppError>>;
}
