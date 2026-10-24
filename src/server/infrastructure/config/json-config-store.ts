import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_CONFIG,
  parseConfig,
  type StudioConfig,
} from "../../../core/config/studio-config.ts";
import { err, ok, type Result } from "../../../core/result.ts";
import { type AppError, appError } from "../../application/app-error.ts";
import type { ConfigStore } from "../../application/config-store.ts";

const FILE_NAME = "config.json";
const APP_FOLDER = "portless-studio";

/**
 * `PORTLESS_STUDIO_CONFIG` when set; otherwise `%APPDATA%\portless-studio\config.json` on Windows
 * and `$XDG_CONFIG_HOME` or `~/.config` + `/portless-studio/config.json` elsewhere.
 */
export function defaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  if (env.PORTLESS_STUDIO_CONFIG) return env.PORTLESS_STUDIO_CONFIG;
  if (platform === "win32") {
    const appData = env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, APP_FOLDER, FILE_NAME);
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), APP_FOLDER, FILE_NAME);
}

export type JsonConfigStoreOptions = {
  /** Waits for a burst of file events (editors write in several steps) to settle. */
  debounceMs?: number;
  /** Catches what file events miss, such as a folder created after the watch started. */
  pollMs?: number;
};

/** The config as a JSON file people can edit by hand. Missing fields take their defaults. */
export class JsonConfigStore implements ConfigStore {
  readonly path: string;
  readonly #debounceMs: number;
  readonly #pollMs: number;

  constructor(filePath: string, options: JsonConfigStoreOptions = {}) {
    this.path = filePath;
    this.#debounceMs = options.debounceMs ?? 100;
    this.#pollMs = options.pollMs ?? 2000;
  }

  async read(): Promise<Result<StudioConfig, AppError>> {
    const text = this.#readText();
    if (text === null) return ok({ ...DEFAULT_CONFIG });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return err(
        appError("invalid_config", `${this.path} is not valid JSON: ${(error as Error).message}`),
      );
    }
    const config = parseConfig(json);
    if (!config.ok) return err(appError("invalid_config", config.error));
    return config;
  }

  async write(config: StudioConfig): Promise<Result<void, AppError>> {
    // Writing a temporary file and renaming it means a reader never sees half a file.
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`);
      fs.renameSync(temporary, this.path);
      return ok(undefined);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      return err(appError("internal", `Could not write ${this.path}: ${(error as Error).message}`));
    }
  }

  watch(onChange: () => void): () => void {
    let last = this.#readText();
    let debounce: NodeJS.Timeout | undefined;
    const check = () => {
      const next = this.#readText();
      if (next === last) return;
      last = next;
      onChange();
    };
    const schedule = () => {
      clearTimeout(debounce);
      debounce = setTimeout(check, this.#debounceMs);
    };

    let watcher: fs.FSWatcher | undefined;
    try {
      // The folder, not the file: the rename in `write` and most editors replace the file.
      watcher = fs.watch(path.dirname(this.path), schedule);
      watcher.on("error", () => watcher?.close());
    } catch {
      watcher = undefined;
    }
    const poll = setInterval(check, this.#pollMs);
    poll.unref();

    return () => {
      clearTimeout(debounce);
      clearInterval(poll);
      watcher?.close();
    };
  }

  #readText(): string | null {
    try {
      return fs.readFileSync(this.path, "utf8");
    } catch {
      return null;
    }
  }
}
