import type { Snapshot } from "../../core/api/contract.ts";
import type { Result } from "../../core/result.ts";
import type { AppError } from "./app-error.ts";

/**
 * Where routes live and how they change. The portless adapter is one implementation; another
 * backend only has to implement these four methods.
 */
export interface RouteRegistry {
  readSnapshot(): Promise<Snapshot>;
  /** Calls `onChange` after the routes or the proxy status change. Returns an unsubscribe. */
  watch(onChange: () => void): () => void;
  /** `name` is already validated and has no TLD. */
  createAlias(name: string, port: number, force: boolean): Promise<Result<void, AppError>>;
  removeAlias(name: string): Promise<Result<void, AppError>>;
}
