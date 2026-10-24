import * as fs from "node:fs";
import * as path from "node:path";
import type { RouteRegistry } from "../../application/route-registry.ts";

const FILE_NAME = "proxy-started.json";

/** A portless proxy Studio started: its pid, so `uninstall` stops only that one. */
export type ProxyStartRecord = { pid: number; startedAt: number };

/** `proxy-started.json` in the config file's folder. */
export function proxyStartRecordPathFor(configPath: string): string {
  return path.join(path.dirname(configPath), FILE_NAME);
}

export function readProxyStartRecord(file: string): ProxyStartRecord | null {
  try {
    const json: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const pid = typeof json === "object" && json !== null ? Reflect.get(json, "pid") : undefined;
    const startedAt =
      typeof json === "object" && json !== null ? Reflect.get(json, "startedAt") : undefined;
    if (!Number.isInteger(pid) || typeof startedAt !== "number") return null;
    return { pid: pid as number, startedAt };
  } catch {
    return null;
  }
}

/**
 * The same registry, but each proxy it starts is written down with its pid. Every place Studio
 * starts the proxy (at launch, in `init`, from the page) goes through it, so the record says which
 * proxy is Studio's and which one a person started by hand.
 */
export function recordProxyStarts(
  registry: RouteRegistry,
  file: string,
  now: () => number = Date.now,
): RouteRegistry {
  return {
    readSnapshot: () => registry.readSnapshot(),
    watch: (onChange) => registry.watch(onChange),
    createAlias: (name, port, force) => registry.createAlias(name, port, force),
    removeAlias: (name) => registry.removeAlias(name),
    installPortless: () => registry.installPortless(),
    stopProxy: () => registry.stopProxy(),
    proxyPid: () => registry.proxyPid(),
    startProxy: async (port, https) => {
      const started = await registry.startProxy(port, https);
      if (!started.ok) return started;
      const pid = await registry.proxyPid().catch(() => null);
      if (pid !== null) write(file, { pid, startedAt: now() });
      return started;
    },
  };
}

function write(file: string, record: ProxyStartRecord): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  } catch {
    // Best effort: without the record, uninstall leaves the proxy running and says so.
  }
}
