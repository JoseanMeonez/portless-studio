import * as fs from "node:fs";
import * as path from "node:path";
import { type CustomApp, isCustomApp } from "../../../core/projects/custom-app.ts";
import type { ItemProject } from "../../../core/routes/route.ts";
import type { CustomAppStore } from "../../application/open-with.ts";
import type { RouteProjectStore } from "../../application/studio-runtime.ts";

/** `route-projects.json` in the config file's folder. */
export function routeProjectsPathFor(configPath: string): string {
  return path.join(path.dirname(configPath), "route-projects.json");
}

/** `open-with.json` in the config file's folder. */
export function openWithPathFor(configPath: string): string {
  return path.join(path.dirname(configPath), "open-with.json");
}

/**
 * The last project seen for each route, as `{ "routeProjects": { "<name>": ItemProject } }`, so
 * a route whose server is down still shows where it ran after a restart. Studio writes it alone.
 */
export class JsonRouteProjectStore implements RouteProjectStore {
  readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  async read(): Promise<Record<string, ItemProject>> {
    const map = (readJson(this.path) as { routeProjects?: unknown } | null)?.routeProjects;
    if (typeof map !== "object" || map === null) return {};
    const projects: Record<string, ItemProject> = {};
    for (const [name, value] of Object.entries(map)) {
      if (isItemProject(value)) projects[name] = value;
    }
    return projects;
  }

  async write(projects: Record<string, ItemProject>): Promise<void> {
    writeJson(this.path, { routeProjects: projects });
  }
}

/**
 * Apps the person added to the open-with menu, as `{ "customApps": [{ name, command }] }`. Kept
 * out of the config file so the config schema stays as it is; see docs/architecture.md.
 */
export class JsonCustomAppStore implements CustomAppStore {
  readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  async read(): Promise<CustomApp[]> {
    const list = (readJson(this.path) as { customApps?: unknown } | null)?.customApps;
    return Array.isArray(list) ? list.filter(isCustomApp) : [];
  }

  async write(apps: CustomApp[]): Promise<void> {
    writeJson(this.path, { customApps: apps });
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Same as the config: a temporary file renamed into place, so a reader never sees half.
function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function isItemProject(value: unknown): value is ItemProject {
  if (typeof value !== "object" || value === null) return false;
  const project = value as Partial<ItemProject>;
  const optionalText = (field: unknown) =>
    field === undefined || field === null || typeof field === "string";
  return (
    typeof project.name === "string" &&
    (project.worktree === null || typeof project.worktree === "string") &&
    optionalText(project.branch) &&
    optionalText(project.path)
  );
}
