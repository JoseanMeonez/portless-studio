import type { StudioAction } from "../core/api/contract.ts";
import { err, ok, type Result } from "../core/result.ts";
import { type AppError, appError } from "../server/application/app-error.ts";
import type {
  LoginServiceState,
  PreparedStudioAction,
  StudioServiceControl,
} from "../server/application/studio-service.ts";
import {
  restartService,
  type ServiceEnv,
  serviceStartCommand,
  serviceStatus,
  stopService,
} from "./login-service.ts";

export type StudioServiceControlOptions = {
  /** Null when Studio runs from its TypeScript source and has no login service. */
  env: ServiceEnv | null;
  /** Shuts this Studio down: removes its alias, closes the server and exits. */
  exitSelf: () => Promise<void>;
};

const TERMINAL_START = "portless-studio";

/**
 * Restart and stop for Studio. When it runs as the login service, systemd or launchd do it, so
 * the service comes back the way it was installed. Otherwise a stop exits this process, and a
 * restart is refused: nothing would start Studio again.
 */
export function createStudioServiceControl(
  options: StudioServiceControlOptions,
): StudioServiceControl {
  const { env, exitSelf } = options;

  const managed = async (): Promise<ServiceEnv | null> => {
    if (env === null || env.platform === "win32") return null;
    const state = await serviceStatus(env);
    return state.installed && state.running ? env : null;
  };

  return {
    status: async (): Promise<LoginServiceState | null> => {
      if (env === null) return null;
      const { installed, running } = await serviceStatus(env);
      return { installed, running };
    },

    prepare: async (action: StudioAction): Promise<Result<PreparedStudioAction, AppError>> => {
      const service = await managed();
      if (action === "restart") {
        if (env?.platform === "win32") {
          return err(
            appError(
              "unsupported",
              "Windows has no service manager Studio can ask to restart it. Stop Studio here, " +
                "then start it again with portless-studio.",
              TERMINAL_START,
            ),
          );
        }
        if (service === null) {
          return err(
            appError(
              "unsupported",
              "Studio was started from a terminal, so nothing would start it again. Stop it and " +
                "run portless-studio, or set it to start at login with portless-studio service install.",
              "portless-studio service install",
            ),
          );
        }
        return ok({
          message: "Studio is restarting.",
          startCommand: serviceStartCommand(service),
          run: async () => {
            await restartService(service);
          },
        });
      }

      return ok({
        message: "Studio is stopping.",
        startCommand: service ? serviceStartCommand(service) : TERMINAL_START,
        run: async () => {
          // If the service manager refuses, stop anyway: that is what the person asked for.
          if (service && (await stopService(service)).ok) return;
          await exitSelf();
        },
      });
    },
  };
}
