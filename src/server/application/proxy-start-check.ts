import { err, ok, type Result } from "../../core/result.ts";
import { type AppError, appError } from "./app-error.ts";
import type { ListeningPort } from "./port-scanner.ts";
import type { RouteRegistry } from "./route-registry.ts";

export type ProxyStartCheckDeps = {
  /** Lists listening ports; the default is the system port scanner. */
  scan: () => Promise<ListeningPort[]>;
  /** Which of these pids run `portless proxy start`, from any state directory. */
  proxyPids?: (pids: number[]) => Promise<ReadonlySet<number>>;
  sleep?: (ms: number) => Promise<void>;
  /** How many times the start is checked before it counts as failed. */
  attempts?: number;
  intervalMs?: number;
};

/** Unknown when the ports cannot be listed on this system right now. */
type Holder = ListeningPort | null | "unknown";

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_INTERVAL_MS = 250;

/**
 * The same registry, but a proxy start counts only once the proxy portless recorded is alive and
 * the port listens. `portless proxy start` can exit 0 while another proxy, with another state
 * directory, already holds the port; without this check Studio would report a start that never
 * happened.
 */
export function confirmProxyStarts(
  registry: RouteRegistry,
  deps: ProxyStartCheckDeps,
): RouteRegistry {
  return {
    readSnapshot: () => registry.readSnapshot(),
    watch: (onChange) => registry.watch(onChange),
    createAlias: (name, port, force) => registry.createAlias(name, port, force),
    removeAlias: (name) => registry.removeAlias(name),
    installPortless: () => registry.installPortless(),
    stopProxy: () => registry.stopProxy(),
    proxyPid: () => registry.proxyPid(),
    startProxy: (port, https) => startConfirmed(registry, deps, port, https),
  };
}

async function startConfirmed(
  registry: RouteRegistry,
  deps: ProxyStartCheckDeps,
  port: number,
  https: boolean,
): Promise<Result<void, AppError>> {
  const ownPid = await registry.proxyPid().catch(() => null);
  const before = await holderOf(deps, port);
  // Our own proxy may still hold the port for a moment after a stop, during a restart.
  if (before !== null && before !== "unknown" && (before.pid === null || before.pid !== ownPid)) {
    return err(await inUse(deps, port, before));
  }

  const started = await registry.startProxy(port, https);
  if (!started.ok) return started;

  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.attempts ?? DEFAULT_ATTEMPTS;
  let holder: Holder = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(deps.intervalMs ?? DEFAULT_INTERVAL_MS);
    holder = await holderOf(deps, port);
    const { proxy } = await registry.readSnapshot();
    if (!proxy.running) continue;
    // Without a port list, a live recorded pid is all there is to go on.
    if (holder === "unknown") return ok(undefined);
    if (holder !== null && (await isOurs(registry, deps, holder))) return ok(undefined);
  }
  if (holder !== null && holder !== "unknown") return err(await inUse(deps, port, holder));
  return err(
    appError(
      "command_failed",
      `portless reported a start, but no proxy listens on port ${port}. Run \`portless proxy ` +
        "start` in a terminal to see why.",
    ),
  );
}

/** The listener is the proxy portless recorded, or a portless proxy it forked. */
async function isOurs(
  registry: RouteRegistry,
  deps: ProxyStartCheckDeps,
  holder: ListeningPort,
): Promise<boolean> {
  if (holder.pid === null) return true;
  if (holder.pid === (await registry.proxyPid().catch(() => null))) return true;
  return (await proxyPidsAmong(deps, [holder.pid])).has(holder.pid);
}

async function holderOf(deps: ProxyStartCheckDeps, port: number): Promise<Holder> {
  try {
    return (await deps.scan()).find((item) => item.port === port) ?? null;
  } catch {
    return "unknown";
  }
}

async function inUse(
  deps: ProxyStartCheckDeps,
  port: number,
  holder: ListeningPort,
): Promise<AppError> {
  const { pid } = holder;
  if (pid !== null && (await proxyPidsAmong(deps, [pid])).has(pid)) {
    return appError(
      "port_in_use",
      `port ${port} is already used by another portless proxy (pid ${pid}) that keeps its state ` +
        "in a different folder. Stop that proxy, or set proxyPort to a free port.",
    );
  }
  const who = [holder.processName, pid === null ? "" : `pid ${pid}`].filter(Boolean).join(", ");
  return appError(
    "port_in_use",
    `port ${port} is in use by another process${who === "" ? "" : ` (${who})`}.`,
  );
}

async function proxyPidsAmong(
  deps: ProxyStartCheckDeps,
  pids: number[],
): Promise<ReadonlySet<number>> {
  if (!deps.proxyPids) return new Set();
  return deps.proxyPids(pids).catch(() => new Set<number>());
}
