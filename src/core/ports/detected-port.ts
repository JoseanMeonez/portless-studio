import type { ItemProject } from "../routes/route.ts";
import { parseRouteName } from "../routes/route-name.ts";
import type { ContainerSummary } from "./docker-container.ts";
import {
  DEFAULT_NAME_TEMPLATE,
  dnsLabel,
  parseNameTemplate,
  renderNameTemplate,
} from "./name-template.ts";

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
  /** The Docker container publishing the port; absent for ordinary processes. */
  container?: ContainerSummary;
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
 * Suggests a route name from a template, by default `{work}.{package}.{repo}`, the order portless
 * uses for worktrees: `ed-1234.web.acme`. Scopes are dropped (`@acme/web` -> `web`) and a package
 * named like its repository gives one label. See docs/naming.md for every token.
 *
 * `{work}` says what the work is, so two checkouts of one app get different names: a ticket key in
 * the branch (`feat/ED-1234-add-x` -> `ed-1234`), else the branch's last segment (`dark-mode`). On a
 * default branch or a detached HEAD it is the linked worktree's folder, if any. When the branch
 * gives the work, `{repo}` drops a `-monorepo`, `-mono` or `-repo` suffix; on the default branch
 * the full folder stays so names given there never change. Returns null for an invalid template.
 */
export function suggestName(
  info: ProjectInfo,
  template: string = DEFAULT_NAME_TEMPLATE,
  port?: number | null,
): string | null {
  const parsedTemplate = parseNameTemplate(template);
  if (!parsedTemplate.ok) return null;
  const branch = info.branch ?? null;
  const branchWork = workLabel(branch);
  const pkg = dnsLabel(info.packageName?.replace(/^@[^/]+\//, "") ?? null);
  const fullRepo = dnsLabel(info.repoName);
  const repo = branchWork && fullRepo ? fullRepo.replace(REPO_SUFFIX, "") || fullRepo : fullRepo;
  const folder = dnsLabel(info.folderName);
  const worktree = dnsLabel(info.worktreeName);

  const name = renderNameTemplate(parsedTemplate.value, {
    work: branchWork ?? worktree,
    branch: dnsLabel(branch),
    ticket: ticketKey(branch),
    package: pkg,
    // A folder outside any repository and package still gets a name.
    repo: repo ?? (pkg === null ? folder : null),
    worktree,
    folder,
    port: port === undefined || port === null ? null : String(port),
  });
  if (name === null) return null;
  const parsed = parseRouteName(name);
  return parsed.ok ? parsed.value : null;
}

/** The ticket key or the branch's last segment, or null for a default branch or no branch. */
function workLabel(branch: string | null): string | null {
  if (branch === null || DEFAULT_BRANCHES.has(branch)) return null;
  return ticketKey(branch) ?? dnsLabel(branch.split("/").pop() ?? null);
}

function ticketKey(branch: string | null): string | null {
  const ticket = branch === null ? undefined : TICKET_KEY.exec(branch)?.[1];
  return ticket ? ticket.toLowerCase() : null;
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
