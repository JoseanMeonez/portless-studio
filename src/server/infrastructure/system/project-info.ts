import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectInfo } from "../../../core/ports/detected-port.ts";
import type { ProjectInfoSource } from "../../application/port-discovery.ts";

// `.git` of a linked worktree is a file: `gitdir: /code/acme/.git/worktrees/falcon`.
const GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
const WORKTREE_GITDIR = /^(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/;
const BRANCH_REF = /^ref:\s*refs\/heads\/(.+?)\s*$/;

/**
 * Reads what a folder belongs to: the nearest package.json and the git repository. The walk stops
 * at the git root, the home folder or the filesystem root, so a dotfiles repo in home never names
 * every project.
 */
export class ProjectInfoReader implements ProjectInfoSource {
  readonly #home: string;
  readonly #ignoreCase: boolean;
  readonly #cache = new Map<string, { info: ProjectInfo; gitDir: string | null }>();

  /**
   * Home is compared by real path on both sides, so a symlinked home, macOS temp folders under
   * `/var` (really `/private/var`) and Windows short names (`RUNNER~1`) still match. On Windows
   * and macOS, whose file names ignore case, the comparison ignores case too.
   */
  constructor(home: string = os.homedir(), platform: NodeJS.Platform = process.platform) {
    this.#ignoreCase = platform === "win32" || platform === "darwin";
    this.#home = this.#key(realPath(path.resolve(home)));
  }

  #key(dir: string): string {
    return this.#ignoreCase ? dir.toLowerCase() : dir;
  }

  #isHome(dir: string): boolean {
    return this.#key(dir) === this.#home || this.#key(realPath(dir)) === this.#home;
  }

  /** The folder walk is cached per folder; the branch is read again each time, it is one file. */
  read(cwd: string): ProjectInfo {
    let cached = this.#cache.get(cwd);
    if (!cached) {
      cached = this.#inspect(path.resolve(cwd));
      this.#cache.set(cwd, cached);
    }
    const branch = cached.gitDir === null ? null : readBranch(cached.gitDir);
    return { ...cached.info, branch };
  }

  #inspect(cwd: string): { info: ProjectInfo; gitDir: string | null } {
    let gitDir: string | null = null;
    const info: ProjectInfo = {
      packageName: null,
      repoName: null,
      folderName: path.basename(cwd) || null,
      worktreeName: null,
      rootDir: null,
    };
    let dir = cwd;
    while (!this.#isHome(dir)) {
      const packageName = readPackageName(dir);
      if (info.packageName === null && packageName !== null) {
        info.packageName = packageName;
        info.rootDir = dir;
      }
      const git = gitKind(dir);
      if (git !== null) gitDir = git.gitDir;
      if (git?.mainRepo === null) {
        info.repoName = path.basename(dir);
        info.rootDir = dir;
        break;
      }
      if (git !== null && git.mainRepo !== null) {
        info.repoName = path.basename(git.mainRepo);
        info.worktreeName = path.basename(dir);
        info.rootDir = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return { info, gitDir };
  }
}

function realPath(dir: string): string {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return dir;
  }
}

function readPackageName(dir: string): string | null {
  try {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const name = typeof pkg === "object" && pkg !== null ? Reflect.get(pkg, "name") : undefined;
    return typeof name === "string" && name.trim() !== "" ? name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Whether a folder is a git root: its git directory, and the main repository folder when it is a
 * linked worktree (`mainRepo` is null for a plain repository).
 */
function gitKind(dir: string): { gitDir: string; mainRepo: string | null } | null {
  const gitPath = path.join(dir, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return { gitDir: gitPath, mainRepo: null };
    const line = GITDIR_LINE.exec(fs.readFileSync(gitPath, "utf8"))?.[1];
    if (!line) return { gitDir: gitPath, mainRepo: null };
    const gitDir = path.resolve(dir, line);
    // A `.git` file that is not a worktree link (a submodule) still marks a repository root.
    return { gitDir, mainRepo: WORKTREE_GITDIR.exec(line)?.[1] ?? null };
  } catch {
    return null;
  }
}

/** The branch `HEAD` points at, read from the file so no `git` process starts. */
function readBranch(gitDir: string): string | null {
  try {
    return BRANCH_REF.exec(fs.readFileSync(path.join(gitDir, "HEAD"), "utf8"))?.[1] ?? null;
  } catch {
    return null;
  }
}
