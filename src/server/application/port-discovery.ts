import type { StudioConfig } from "../../core/config/studio-config.ts";
import {
  type DetectedPort,
  type ProjectInfo,
  suggestName,
} from "../../core/ports/detected-port.ts";
import type { Route } from "../../core/routes/route.ts";
import type { ListeningPort, PortScanner } from "./port-scanner.ts";

/** Reads what project a folder belongs to. The default implementation reads package.json and git. */
export interface ProjectInfoSource {
  read(cwd: string): ProjectInfo;
}

export type DiscoveryContext = {
  config: StudioConfig;
  /** Ports that already have a portless name. */
  routes: readonly Route[];
  /** Studio's own port and the portless proxy port. */
  excludedPorts: readonly number[];
};

/**
 * Listening ports a person would want to name: they answer HTTP, have no portless route, and are
 * not Studio, the proxy or something the config ignores. Sorted by port.
 */
export async function discoverPorts(
  scanner: PortScanner,
  projects: ProjectInfoSource,
  context: DiscoveryContext,
): Promise<DetectedPort[]> {
  const skippedPorts = new Set([
    ...context.routes.map((route) => route.port),
    ...context.excludedPorts,
    ...context.config.ignoredPorts,
  ]);
  const skippedProcesses = new Set(
    context.config.ignoredProcesses.map((name) => name.toLowerCase()),
  );
  // A port whose process we cannot read belongs to another user or the system (printing, DNS),
  // never to a dev server this person started.
  const candidates = (await scanner.scan()).filter(
    (port) =>
      port.pid !== null &&
      !skippedPorts.has(port.port) &&
      !skippedProcesses.has(port.processName.toLowerCase()),
  );
  // Probes run in parallel; a port that never answers costs its timeout once, not per port.
  const answers = await Promise.all(candidates.map((port) => scanner.answersHttp(port.port)));
  return candidates
    .filter((port, index) => answers[index] && isDevServer(port, projects))
    .map((port) => toDetected(port, projects))
    .sort((a, b) => a.port - b.port);
}

// Interpreters dev servers run on. Anything else counts only when it was built inside the
// project, like `target/debug/api`, so editors, chat apps and background tools stay out.
const DEV_RUNTIME = /^(node|nodejs|bun|deno|python\d*(\.\d+)?|ruby|php|java|dotnet)$/i;

function isDevServer(port: ListeningPort, projects: ProjectInfoSource): boolean {
  if (!port.executable) return true;
  if (DEV_RUNTIME.test(port.processName)) return true;
  const root = port.cwd === null ? null : projects.read(port.cwd).rootDir;
  return Boolean(root) && port.executable.startsWith(`${root}/`);
}

function toDetected(port: ListeningPort, projects: ProjectInfoSource): DetectedPort {
  return {
    port: port.port,
    pid: port.pid,
    processName: port.processName,
    cwd: port.cwd,
    suggestedName: port.cwd === null ? null : suggestName(projects.read(port.cwd)),
  };
}
