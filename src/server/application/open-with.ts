import type { CustomAppsResponse, OpenWithApp, OpenWithRequest } from "../../core/api/contract.ts";
import {
  type CustomApp,
  commandFor,
  customAppId,
  PATH_PLACEHOLDER,
  parseCustomApps,
} from "../../core/projects/custom-app.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { type AppError, appError } from "./app-error.ts";

/** A program and its arguments; started without a shell. */
export type LaunchCommand = {
  file: string;
  args: string[];
  /**
   * Windows only: pass the arguments exactly as written, for programs that parse their own
   * command line, like `explorer /select,"<path>"`.
   */
  windowsVerbatim?: boolean;
};

/** An editor or file manager found on this machine; `{path}` in `command.args` is the folder. */
export type InstalledApp = {
  id: string;
  name: string;
  kind: "editor" | "file-manager";
  command: LaunchCommand;
};

/** Finds the apps installed on this machine. The default looks at PATH and install folders. */
export interface AppCatalog {
  installed(): Promise<InstalledApp[]>;
}

/** Starts a program that outlives the request; resolves once it started or failed to. */
export interface AppLauncher {
  launch(command: LaunchCommand): Promise<Result<void, AppError>>;
}

/** Where the apps added in Settings are kept; the default is `open-with.json` by the config. */
export interface CustomAppStore {
  readonly path: string;
  read(): Promise<CustomApp[]>;
  write(apps: CustomApp[]): Promise<void>;
}

export type OpenWithOptions = {
  catalog: AppCatalog;
  launcher: AppLauncher;
  customApps: CustomAppStore;
  /** The only folders that may be opened: the ones Studio shows for routes and detected ports. */
  openableFolders: () => Promise<ReadonlySet<string>>;
};

/** Opens a project folder in an editor, the file manager or an app the person added. */
export class OpenWith {
  readonly #options: OpenWithOptions;

  constructor(options: OpenWithOptions) {
    this.#options = options;
  }

  /** Apps found on the machine first, in catalog order, then the custom ones. */
  async apps(): Promise<OpenWithApp[]> {
    const installed = await this.#options.catalog.installed();
    const custom = await this.#options.customApps.read();
    return [
      ...installed.map(({ id, name, kind }) => ({ id, name, kind })),
      ...custom.map((app, index) => ({
        id: customAppId(index),
        name: app.name,
        kind: "custom" as const,
      })),
    ];
  }

  async open(input: unknown): Promise<Result<void, AppError>> {
    const request = toRequest(input);
    if (request === null) {
      return err(appError("invalid_request", "Send the app id and the folder to open."));
    }
    // Exact match only: a path the client builds itself, even inside a known folder, is refused.
    const folders = await this.#options.openableFolders();
    if (!folders.has(request.path)) {
      return err(
        appError("path_not_allowed", "Studio only opens the folders of the servers it shows."),
      );
    }
    const command = await this.#commandFor(request);
    if (!command.ok) return command;
    return this.#options.launcher.launch(command.value);
  }

  async readCustomApps(): Promise<CustomAppsResponse> {
    return { apps: await this.#options.customApps.read(), path: this.#options.customApps.path };
  }

  /** Replaces the custom apps with `{ apps }`; fails naming the first entry that does not parse. */
  async updateCustomApps(input: unknown): Promise<Result<CustomAppsResponse, AppError>> {
    const apps = parseCustomApps((input as { apps?: unknown } | null)?.apps);
    if (!apps.ok) return err(appError("invalid_request", apps.error));
    try {
      await this.#options.customApps.write(apps.value);
    } catch (error) {
      return err(
        appError("internal", `Could not save the custom apps: ${(error as Error).message}`),
      );
    }
    return ok({ apps: apps.value, path: this.#options.customApps.path });
  }

  async #commandFor(request: OpenWithRequest): Promise<Result<LaunchCommand, AppError>> {
    const installed = (await this.#options.catalog.installed()).find(
      (app) => app.id === request.appId,
    );
    if (installed) {
      const { command } = installed;
      return ok({
        ...command,
        args: command.args.map((arg) => arg.split(PATH_PLACEHOLDER).join(request.path)),
      });
    }
    const custom = (await this.#options.customApps.read()).find(
      (_app, index) => customAppId(index) === request.appId,
    );
    if (!custom) return err(appError("unknown_app", "That app is not on this machine anymore."));
    const command = commandFor(custom.command, request.path);
    return command.ok
      ? ok(command.value)
      : err(appError("invalid_request", `${custom.name}: ${command.error}`));
  }
}

function toRequest(input: unknown): OpenWithRequest | null {
  const fields = (typeof input === "object" && input !== null ? input : {}) as Partial<
    Record<keyof OpenWithRequest, unknown>
  >;
  if (typeof fields.appId !== "string" || typeof fields.path !== "string") return null;
  return { appId: fields.appId, path: fields.path };
}
