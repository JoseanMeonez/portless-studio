import type { InstallPortlessResponse, Snapshot } from "../../core/api/contract.ts";
import type { Result } from "../../core/result.ts";
import type { AppError } from "./app-error.ts";

/** The part of the snapshot portless owns. Detected ports and auto mode are added by Studio. */
export type PortlessState = Omit<Snapshot, "detected" | "autoName">;

/**
 * Where routes live and how they change. The portless adapter is one implementation; another
 * backend only has to implement these five methods.
 */
export interface RouteRegistry {
  readSnapshot(): Promise<PortlessState>;
  /** Calls `onChange` after the routes or the proxy status change. Returns an unsubscribe. */
  watch(onChange: () => void): () => void;
  /** `name` is already validated and has no TLD. */
  createAlias(name: string, port: number, force: boolean): Promise<Result<void, AppError>>;
  removeAlias(name: string): Promise<Result<void, AppError>>;
  /**
   * Installs portless with `npm install -g portless`, then detects it again and notifies watchers.
   * Fails with `install_in_progress` while another install runs, `install_failed` when npm fails.
   */
  installPortless(): Promise<Result<InstallPortlessResponse, AppError>>;
}
