import type { ProjectInfo } from "./detected-port.ts";

/** A running container as `docker ps` lists it, with the host ports it publishes. */
export type DockerContainer = {
  name: string;
  image: string;
  /** `com.docker.compose.project` label; null outside Docker Compose. */
  composeProject: string | null;
  /** `com.docker.compose.service` label; null outside Docker Compose. */
  composeService: string | null;
  /** TCP ports published on the host, sorted. */
  ports: number[];
};

/** What a detected row shows about the container behind its port. */
export type ContainerSummary = {
  name: string;
  image: string;
  composeProject: string | null;
};

// Docker's own rule for container names; it also keeps names from reading as flags.
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
// A host binding such as `0.0.0.0:8000-8002->8000-8002/tcp` or `[::]:8080->80/tcp`.
const BINDING = /:(\d+)(?:-(\d+))?->\d+(?:-\d+)?\/(tcp|udp|sctp)$/;
// A range wider than this is a mistake in the compose file, not something to probe port by port.
const MAX_RANGE = 1000;

export function isContainerName(value: string): boolean {
  return CONTAINER_NAME.test(value);
}

/** Host TCP ports from the `Ports` column; unpublished ports (`80/tcp`) and UDP are skipped. */
export function parsePublishedPorts(text: string): number[] {
  const ports = new Set<number>();
  for (const part of text.split(",")) {
    const match = BINDING.exec(part.trim());
    if (match?.[3] !== "tcp") continue;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (last < first || last - first >= MAX_RANGE) continue;
    for (let port = first; port <= last; port += 1) {
      if (port >= 1 && port <= 65535) ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

/** Reads `docker ps --format '{{json .}}'`: one JSON object per line. Bad lines are skipped. */
export function parseDockerPs(text: string): DockerContainer[] {
  const containers: DockerContainer[] = [];
  for (const raw of text.split("\n")) {
    const row = parseLine(raw.trim());
    if (row === null) continue;
    const name = (stringField(row, "Names") ?? "").split(",")[0]?.trim() ?? "";
    if (!isContainerName(name)) continue;
    const labels = parseLabels(stringField(row, "Labels") ?? "");
    containers.push({
      name,
      image: stringField(row, "Image") ?? "",
      composeProject: labels.get("com.docker.compose.project") || null,
      composeService: labels.get("com.docker.compose.service") || null,
      ports: parsePublishedPorts(stringField(row, "Ports") ?? ""),
    });
  }
  return containers;
}

/**
 * What the name template reads for a container: the compose service as the package and the
 * compose project as the repository (`api.acme`), else the container name as the folder.
 */
export function containerProjectInfo(container: DockerContainer): ProjectInfo {
  return {
    packageName: container.composeService,
    repoName: container.composeProject,
    folderName: container.name,
    worktreeName: null,
  };
}

function parseLine(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

/** `a=1,b=2`; label values with commas are rare and only the compose labels matter here. */
function parseLabels(text: string): Map<string, string> {
  const labels = new Map<string, string>();
  for (const pair of text.split(",")) {
    const index = pair.indexOf("=");
    if (index > 0) labels.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
  return labels;
}
