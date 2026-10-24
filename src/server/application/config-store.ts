import type { StudioConfig } from "../../core/config/studio-config.ts";
import type { Result } from "../../core/result.ts";
import type { AppError } from "./app-error.ts";

/** Where the StudioConfig is kept. The default implementation is a JSON file. */
export interface ConfigStore {
  /** Location people can open to edit the config by hand. */
  readonly path: string;
  /** The current config; defaults when the file does not exist yet. */
  read(): Promise<Result<StudioConfig, AppError>>;
  write(config: StudioConfig): Promise<Result<void, AppError>>;
  /** Calls `onChange` after the file changes on disk. Returns an unsubscribe. */
  watch(onChange: () => void): () => void;
}
