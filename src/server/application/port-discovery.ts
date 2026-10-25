import type { StudioConfig } from "../../core/config/studio-config.ts";
import {
  type DetectedPort,
  type ProjectInfo,
  projectOf,
  suggestName,
} from "../../core/ports/detected-port.ts";
import { containerProjectInfo, type DockerContainer } from "../../core/ports/docker-container.ts";
import {
  arrangeDetected,
  type DebuggerProbe,
  type ListeningRoute,
  type OtherPort,
  type PortRange,
} from "../../core/ports/helper-ports.ts";
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
  /** Running Docker containers; their published ports count as dev servers. */
  containers?: readonly DockerContainer[];
  /** The system's ephemeral port range; omitted or null turns that rule off. */
  ephemeralRange?: PortRange | null;
};

/** The main Detected list and the helper ports kept under "Other ports". */
export type Discovery = { detected: DetectedPort[]; otherPorts: OtherPort[] };

/** Only the main Detected list of `discoverPortGroups`. */
export async function discoverPorts(
  scanner: PortScanner,
  projects: ProjectInfoSource,
  context: DiscoveryContext,
): Promise<DetectedPort[]> {
  return (await discoverPortGroups(scanner, projects, context)).detected;
}

/**
 * Listening ports a person would want to name: they answer HTTP, have no portless route, and are
 * not Studio, the proxy or something the config ignores. Debuggers, ephemeral ports and ports of a
 * server that already has a name go to `otherPorts` (see `arrangeDetected`). Sorted by port.
 */
export async function discoverPortGroups(
  scanner: PortScanner,
  projects: ProjectInfoSource,
  context: DiscoveryContext,
): Promise<Discovery> {
  const skippedPorts = new Set([
    ...context.routes.map((route) => route.port),
    ...context.excludedPorts,
    ...context.config.ignoredPorts,
  ]);
  const ignored = context.config.ignoredProcesses.map((name) => name.toLowerCase());
  const published = containerPorts(context.containers ?? [], skippedPorts, ignored);
  // A port whose process we cannot read belongs to another user or the system (printing, DNS),
  // never to a dev server this person started. A container's port is shown as the container.
  const scanned = await scanner.scan();
  const candidates = scanned.filter(
    (port) =>
      port.pid !== null &&
      !skippedPorts.has(port.port) &&
      !published.has(port.port) &&
      !isIgnoredProcess(port.processName, ignored),
  );
  const fromContainers = [...published];
  // Probes run in parallel; a port that never answers costs its timeout once, not per port.
  const [answers, containerAnswers] = await Promise.all([
    Promise.all(candidates.map((port) => scanner.answersHttp(port.port))),
    Promise.all(fromContainers.map(([port]) => scanner.answersHttp(port))),
  ]);
  const template = context.config.nameTemplate;
  const found = [
    ...candidates
      .filter((port, index) => answers[index] && isDevServer(port, projects))
      .map((port) => toDetected(port, projects, template)),
    ...fromContainers
      .filter((_, index) => containerAnswers[index])
      .map(([port, container]) => containerDetected(port, container, template)),
  ].sort((a, b) => a.port - b.port);
  return arrangeDetected({
    detected: found,
    debuggers: await debuggerProbes(scanner, found),
    ephemeralRange: context.ephemeralRange ?? null,
    showEphemeral: context.config.showEphemeralPorts,
    routes: listeningRoutes(context.routes, scanned),
  });
}

const UNKNOWN: DebuggerProbe = "unknown";

async function debuggerProbes(
  scanner: PortScanner,
  found: readonly DetectedPort[],
): Promise<Map<number, DebuggerProbe>> {
  const probe = scanner.probeDebugger?.bind(scanner);
  if (!probe) return new Map();
  const answers = await Promise.all(found.map((item) => probe(item.port).catch(() => UNKNOWN)));
  return new Map(found.map((item, index) => [item.port, answers[index] ?? UNKNOWN]));
}

/** Routes whose port a readable process listens on now; a closed route claims no siblings. */
function listeningRoutes(
  routes: readonly Route[],
  scanned: readonly ListeningPort[],
): ListeningRoute[] {
  const byPort = new Map(scanned.map((port) => [port.port, port]));
  return routes.flatMap((route) => {
    const listener = byPort.get(route.port);
    if (!listener || listener.pid === null) return [];
    return [{ name: route.name, port: route.port, pid: listener.pid, cwd: listener.cwd }];
  });
}

/** Published port -> container, without the ports the filters skip. */
function containerPorts(
  containers: readonly DockerContainer[],
  skippedPorts: ReadonlySet<number>,
  ignored: readonly string[],
): Map<number, DockerContainer> {
  const ports = new Map<number, DockerContainer>();
  if (isIgnoredProcess(CONTAINER_PROCESS, ignored)) return ports;
  for (const container of containers) {
    for (const port of container.ports) {
      if (!skippedPorts.has(port) && !ports.has(port)) ports.set(port, container);
    }
  }
  return ports;
}

/** What a container's row shows as its process, and what `ignoredProcesses` matches. */
const CONTAINER_PROCESS = "docker";

function containerDetected(
  port: number,
  container: DockerContainer,
  nameTemplate: string,
): DetectedPort {
  const project = container.composeProject;
  return {
    port,
    pid: null,
    processName: CONTAINER_PROCESS,
    cwd: null,
    suggestedName: suggestName(containerProjectInfo(container), nameTemplate, port),
    ...(project === null ? {} : { project: { name: project, worktree: null } }),
    container: {
      name: container.name,
      image: container.image,
      composeProject: project,
    },
  };
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

function toDetected(
  port: ListeningPort,
  projects: ProjectInfoSource,
  nameTemplate: string,
): DetectedPort {
  const info = port.cwd === null ? null : projects.read(port.cwd);
  const project = info === null ? null : projectOf(info);
  return {
    port: port.port,
    pid: port.pid,
    processName: port.processName,
    cwd: port.cwd,
    suggestedName: info === null ? null : suggestName(info, nameTemplate, port.port),
    ...(project === null ? {} : { project }),
  };
}
