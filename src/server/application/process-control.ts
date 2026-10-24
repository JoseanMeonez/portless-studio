import type { Result } from "../../core/result.ts";
import type { AppError } from "./app-error.ts";

/** Who runs a process, compared with the user Studio runs as. */
export type ProcessOwner = "root" | "you" | "other" | "unknown";

/**
 * Looks at and stops processes on this machine. The system adapter reads `/proc` on Linux, `ps`
 * on macOS and `tasklist` on Windows; tests use a fake.
 */
export interface ProcessControl {
  ownerOf(pid: number): Promise<ProcessOwner>;
  /** Asks the process to exit, then forces it after a grace period if it is still alive. */
  terminate(pid: number): Promise<Result<void, AppError>>;
}
