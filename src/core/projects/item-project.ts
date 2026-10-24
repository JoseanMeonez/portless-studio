import { type ProjectInfo, projectOf } from "../ports/detected-port.ts";
import type { ItemProject } from "../routes/route.ts";

/**
 * The project a process in `cwd` runs from, with where it lives: the branch and the folder a
 * row shows and the open-with menu opens. Null for a loose folder, like `projectOf`.
 */
export function itemProjectAt(info: ProjectInfo, cwd: string): ItemProject | null {
  const project = projectOf(info);
  if (project === null) return null;
  return { ...project, branch: info.branch ?? null, path: info.rootDir ?? cwd };
}
