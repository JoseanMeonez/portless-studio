import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectInfo } from "../../../core/ports/detected-port.ts";
import type { ProjectInfoSource } from "../../application/port-discovery.ts";

// `.git` of a linked worktree is a file: `gitdir: /code/ave/.git/worktrees/falcon`.
const WORKTREE_GITDIR = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/]+\s*$/m;

/**
 * Reads what a folder belongs to: the nearest package.json and the git repository. The walk stops
 * at the git root, the home folder or the filesystem root, so a dotfiles repo in home never names
 * every project.
 */
export class ProjectInfoReader implements ProjectInfoSource {
  readonly #home: string;
  readonly #cache = new Map<string, ProjectInfo>();

  constructor(home: string = os.homedir()) {
    this.#home = path.resolve(home);
  }

  read(cwd: string): ProjectInfo {
    const cached = this.#cache.get(cwd);
    if (cached) return cached;
    const info = this.#inspect(path.resolve(cwd));
    this.#cache.set(cwd, info);
    return info;
  }

  #inspect(cwd: string): ProjectInfo {
    const info: ProjectInfo = {
      packageName: null,
      repoName: null,
      folderName: path.basename(cwd) || null,
      worktreeName: null,
      rootDir: null,
    };
    let dir = cwd;
    while (dir !== this.#home) {
      const packageName = readPackageName(dir);
      if (info.packageName === null && packageName !== null) {
        info.packageName = packageName;
        info.rootDir = dir;
      }
      const git = gitKind(dir);
      if (git === "repository") {
        info.repoName = path.basename(dir);
        info.rootDir = dir;
        break;
      }
      if (git !== null) {
        info.repoName = path.basename(git.mainRepo);
        info.worktreeName = path.basename(dir);
        info.rootDir = dir;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return info;
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

function gitKind(dir: string): "repository" | { mainRepo: string } | null {
  const gitPath = path.join(dir, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) return "repository";
    const match = WORKTREE_GITDIR.exec(fs.readFileSync(gitPath, "utf8"));
    // A `.git` file that is not a worktree link (a submodule) still marks a repository root.
    return match?.[1] ? { mainRepo: match[1] } : "repository";
  } catch {
    return null;
  }
}
