import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectInfoReader } from "./project-info.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

describe("ProjectInfoReader", () => {
  it("reads the nearest package name and the repository folder", () => {
    write("acme/.git/HEAD", "ref: refs/heads/main\n");
    write("acme/package.json", JSON.stringify({ name: "acme-monorepo" }));
    write("acme/apps/web/package.json", JSON.stringify({ name: "@acme/web" }));
    const cwd = path.join(dir, "acme", "apps", "web");

    expect(new ProjectInfoReader(dir).read(cwd)).toEqual({
      packageName: "@acme/web",
      repoName: "acme",
      folderName: "web",
      worktreeName: null,
    });
  });

  it("names the main repository and the worktree for a linked worktree", () => {
    write("ave/.git/HEAD", "ref: refs/heads/main\n");
    const gitdir = path.join(dir, "ave", ".git", "worktrees", "falcon");
    write("trees/falcon/.git", `gitdir: ${gitdir}\n`);
    write("trees/falcon/package.json", JSON.stringify({ name: "shop-admin" }));
    const cwd = path.join(dir, "trees", "falcon");

    expect(new ProjectInfoReader(dir).read(cwd)).toEqual({
      packageName: "shop-admin",
      repoName: "ave",
      folderName: "falcon",
      worktreeName: "falcon",
    });
  });

  it("falls back to the folder name outside git and without package.json", () => {
    fs.mkdirSync(path.join(dir, "scratch", "demo"), { recursive: true });
    expect(new ProjectInfoReader(dir).read(path.join(dir, "scratch", "demo"))).toEqual({
      packageName: null,
      repoName: null,
      folderName: "demo",
      worktreeName: null,
    });
  });

  it("does not look at the home folder itself", () => {
    write("package.json", JSON.stringify({ name: "dotfiles" }));
    write(".git/HEAD", "ref: refs/heads/main\n");
    fs.mkdirSync(path.join(dir, "demo"));
    expect(new ProjectInfoReader(dir).read(path.join(dir, "demo"))).toMatchObject({
      packageName: null,
      repoName: null,
    });
  });

  it("caches the answer per folder", () => {
    write("app/package.json", JSON.stringify({ name: "first" }));
    const reader = new ProjectInfoReader(dir);
    const cwd = path.join(dir, "app");
    expect(reader.read(cwd).packageName).toBe("first");
    write("app/package.json", JSON.stringify({ name: "second" }));
    expect(reader.read(cwd).packageName).toBe("first");
  });
});
