import type { ItemProject } from "../routes/route.ts";
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
  /** Project the process runs in; `null` when unknown, absent from older servers. */
  project?: ItemProject | null;
  /** Emoji or `data:image` URL; absent when unknown, so the page draws a monogram. */
  icon?: string;
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
  /** Checked-out git branch, e.g. `feat/ED-1234-add-x`; null on a detached HEAD or outside git. */
  branch?: string | null;
};

const DEFAULT_BRANCHES = new Set(["main", "master", "develop", "trunk"]);
// A ticket key like `ED-1234` or `run-51`, standing alone between separators.
const TICKET_KEY = /(?:^|[^A-Za-z0-9])([A-Za-z]{2,10}-\d+)(?![A-Za-z0-9])/;
const REPO_SUFFIX = /-(?:monorepo|mono|repo)$/;

/**
 * Suggests a route name the way portless names monorepo packages: `<package>.<project>`, e.g.
 * `web.acme-monorepo`. Scopes are dropped (`@acme/web` -> `web`) and a package named like its
 * repository gets the plain repository name.
 *
 * The prefix says what the work is, so two checkouts of one app get different names: a ticket key
 * in the branch (`feat/ED-1234-add-x` -> `ed-1234.web.acme`), else the branch's last segment
 * (`feat/dark-mode` -> `dark-mode.web.acme`), with the repository's `-monorepo` or `-repo` suffix
 * dropped. On a default branch or a detached HEAD, a linked worktree adds its folder instead:
 * `falcon.web.acme-monorepo`.
 */
export function suggestName(info: ProjectInfo): string | null {
  const work = workLabel(info.branch ?? null);
  const pkg = slug(info.packageName?.replace(/^@[^/]+\//, "") ?? null);
  const fullRepo = slug(info.repoName);
  const repo = work && fullRepo ? fullRepo.replace(REPO_SUFFIX, "") || fullRepo : fullRepo;
  const folder = slug(info.folderName);

  const candidate =
    pkg && repo ? (pkg === repo ? repo : `${pkg}.${repo}`) : (pkg ?? repo ?? folder ?? null);
  if (candidate === null) return null;
  const prefix = work ?? slug(info.worktreeName);
  const parsed = parseRouteName(prefix ? `${prefix}.${candidate}` : candidate);
  return parsed.ok ? parsed.value : null;
}

/** The ticket key or the branch slug, or null for a default branch or no branch. */
function workLabel(branch: string | null): string | null {
  if (branch === null || DEFAULT_BRANCHES.has(branch)) return null;
  const ticket = TICKET_KEY.exec(branch)?.[1];
  if (ticket) return ticket.toLowerCase();
  return slug(branch.split("/").pop() ?? null);
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

/**
 * The project a folder belongs to, for grouping: the repository, or the package when there is no
 * repository. Null when neither is known, so loose folders do not each become a project.
 */
export function projectOf(info: ProjectInfo): ItemProject | null {
  const name = info.repoName ?? info.packageName;
  if (!name) return null;
  return { name, worktree: info.worktreeName };
}
