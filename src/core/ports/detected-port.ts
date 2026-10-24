import { parseRouteName } from "../routes/route-name.ts";

/** A port something on this machine listens on that has no portless name yet. */
export type DetectedPort = {
  port: number;
  pid: number | null;
  /** Executable name as the system reports it, e.g. `node`, `ng`, `python3`. */
  processName: string;
  /** Working folder of the process, when the system lets us read it. */
  cwd: string | null;
  /** Name Studio would give it, or null when nothing useful could be inferred. */
  suggestedName: string | null;
};

/** What we know about the project a process runs in, read from its folder. */
export type ProjectInfo = {
  /** `name` from the nearest package.json, e.g. `@acme/web` or `app`. */
  packageName: string | null;
  /** Folder name of the git repository root, e.g. `acme-monorepo`. */
  repoName: string | null;
  /** Folder name of the process working directory, used when nothing else is known. */
  folderName: string | null;
  /**
   * Folder name of the git worktree when the process runs in a linked worktree, e.g. `falcon`.
   * `repoName` is then the main repository's folder, and the worktree becomes a prefix so two
   * checkouts of the same app get different names.
   */
  worktreeName: string | null;
  /** Folder of the git root, or of the package.json when there is no git. */
  rootDir?: string | null;
};

/**
 * Suggests a route name the way portless names monorepo packages: `<package>.<project>`, e.g.
 * `web.acme-monorepo`. Scopes are dropped (`@acme/web` -> `web`) and a package named like its
 * repository gets the plain repository name. A linked worktree adds its folder as a prefix:
 * `falcon.web.acme-monorepo`.
 */
export function suggestName(info: ProjectInfo): string | null {
  const pkg = slug(info.packageName?.replace(/^@[^/]+\//, "") ?? null);
  const repo = slug(info.repoName);
  const folder = slug(info.folderName);

  const candidate =
    pkg && repo ? (pkg === repo ? repo : `${pkg}.${repo}`) : (pkg ?? repo ?? folder ?? null);
  if (candidate === null) return null;
  const worktree = slug(info.worktreeName);
  const parsed = parseRouteName(worktree ? `${worktree}.${candidate}` : candidate);
  return parsed.ok ? parsed.value : null;
}

function slug(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return cleaned === "" ? null : cleaned;
}
