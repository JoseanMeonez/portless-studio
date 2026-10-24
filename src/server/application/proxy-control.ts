import type { ProxyAction } from "../../core/api/contract.ts";
import type { StudioConfig } from "../../core/config/studio-config.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { type AppError, appError } from "./app-error.ts";
import type { ProcessControl } from "./process-control.ts";
import type { RouteRegistry } from "./route-registry.ts";

export type ProxyControlDeps = {
  registry: RouteRegistry;
  processes: Pick<ProcessControl, "ownerOf">;
  /** The config in effect, for the port and protocol a start uses. */
  config: () => Promise<StudioConfig>;
};

/**
 * Starts, stops or restarts the portless proxy. A proxy started with sudo is never touched: the
 * error carries the command to run instead. Returns a sentence saying what happened.
 */
export async function controlProxy(
  action: ProxyAction,
  deps: ProxyControlDeps,
): Promise<Result<string, AppError>> {
  const { proxy, portless } = await deps.registry.readSnapshot();
  if (!portless.installed) {
    return err(appError("portless_unavailable", "Install portless before starting its proxy."));
  }

  if (proxy.running && action !== "start") {
    const allowed = await checkOwner(deps);
    if (!allowed.ok) return allowed;
    const stopped = await deps.registry.stopProxy();
    if (!stopped.ok) return stopped;
    if (action === "stop") return ok("Stopped the proxy.");
  } else if (action === "stop") {
    return ok("The proxy was not running.");
  } else if (proxy.running) {
    return ok("The proxy is already running.");
  }

  const config = await deps.config();
  const started = await deps.registry.startProxy(config.proxyPort, config.proxyHttps);
  if (!started.ok) return started;
  return ok(
    action === "restart"
      ? `Restarted the proxy on port ${config.proxyPort}.`
      : `Started the proxy on port ${config.proxyPort}.`,
  );
}

async function checkOwner(deps: ProxyControlDeps): Promise<Result<void, AppError>> {
  const pid = await deps.registry.proxyPid();
  const owner = pid === null ? "unknown" : await deps.processes.ownerOf(pid);
  if (owner !== "root" && owner !== "other") return ok(undefined);
  const who = owner === "root" ? "root" : "another user";
  return err(
    appError(
      "needs_admin",
      `The proxy runs as ${who} (pid ${pid}), so stopping it needs sudo.`,
      "sudo portless proxy stop",
    ),
  );
}
