import type { StudioConfig } from "../../core/config/studio-config.ts";
import {
  type DetectedPort,
  type ProjectInfo,
  projectOf,
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
  const ignored = context.config.ignoredProcesses.map((name) => name.toLowerCase());
  // A port whose process we cannot read belongs to another user or the system (printing, DNS),
  // never to a dev server this person started.
  const candidates = (await scanner.scan()).filter(
    (port) =>
      port.pid !== null &&
      !skippedPorts.has(port.port) &&
      !isIgnoredProcess(port.processName, ignored),
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
  if (DEV_RUNTIME.test(withoutExe(port.processName))) return true;
  const root = port.cwd === null ? null : projects.read(port.cwd).rootDir;
  return Boolean(root) && isInsideFolder(root ?? "", port.executable);
}

/**
 * An ignored name matches the process name, or its start followed by a space, dot, dash or
 * parenthesis: `code` covers `Code Helper (Plugin)` and `Code.exe`, but not `codex`.
 */
function isIgnoredProcess(processName: string, ignored: readonly string[]): boolean {
  const name = processName.toLowerCase();
  return ignored.some(
    (entry) =>
      name === entry || (name.startsWith(entry) && /^[ .\-(]/.test(name.slice(entry.length))),
  );
}

function withoutExe(name: string): string {
  return name.replace(/\.exe$/i, "");
}

/**
 * Whether `file` sits inside `folder`. Windows paths (a drive letter or backslashes) compare
 * without case and with either separator; a sibling like `acme-tools` never counts as `acme`.
 */
export function isInsideFolder(folder: string, file: string): boolean {
  const windows = /^[A-Za-z]:|\\/.test(folder);
  const normalize = (value: string) =>
    windows
      ? value.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "")
      : value.replace(/\/+$/, "");
  const root = normalize(folder);
  if (root === "") return false;
  return normalize(file).startsWith(`${root}${windows ? "\\" : "/"}`);
}

function toDetected(port: ListeningPort, projects: ProjectInfoSource): DetectedPort {
  const info = port.cwd === null ? null : projects.read(port.cwd);
  const project = info === null ? null : projectOf(info);
  return {
    port: port.port,
    pid: port.pid,
    processName: port.processName,
    cwd: port.cwd,
    suggestedName: info === null ? null : suggestName(info),
    ...(project === null ? {} : { project }),
  };
}
