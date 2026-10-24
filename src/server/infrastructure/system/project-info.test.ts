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
      rootDir: path.join(dir, "acme"),
      branch: "main",
    });
  });

  it("reads the current branch of a repository", () => {
    write("acme/.git/HEAD", "ref: refs/heads/feat/ED-1234-add-x\n");
    write("acme/package.json", JSON.stringify({ name: "acme" }));
    expect(new ProjectInfoReader(dir).read(path.join(dir, "acme")).branch).toBe(
      "feat/ED-1234-add-x",
    );
  });

  it("reads the branch of a linked worktree from its own gitdir", () => {
    write("acme/.git/HEAD", "ref: refs/heads/main\n");
    write("acme/.git/worktrees/otter/HEAD", "ref: refs/heads/fix/run-51\n");
    write("trees/otter/.git", `gitdir: ${path.join(dir, "acme", ".git", "worktrees", "otter")}\n`);
    expect(new ProjectInfoReader(dir).read(path.join(dir, "trees", "otter")).branch).toBe(
      "fix/run-51",
    );
  });

  it("has no branch on a detached HEAD", () => {
    write("acme/.git/HEAD", "3f2a9c1d0e8b7a6f5e4d3c2b1a0f9e8d7c6b5a49\n");
    expect(new ProjectInfoReader(dir).read(path.join(dir, "acme")).branch).toBeNull();
  });

  it("reads the branch again after a checkout", () => {
    write("acme/.git/HEAD", "ref: refs/heads/feat/one\n");
    const reader = new ProjectInfoReader(dir);
    const cwd = path.join(dir, "acme");
    expect(reader.read(cwd).branch).toBe("feat/one");
    write("acme/.git/HEAD", "ref: refs/heads/feat/two\n");
    expect(reader.read(cwd).branch).toBe("feat/two");
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
      rootDir: cwd,
      branch: null,
    });
  });

  it("falls back to the folder name outside git and without package.json", () => {
    fs.mkdirSync(path.join(dir, "scratch", "demo"), { recursive: true });
    expect(new ProjectInfoReader(dir).read(path.join(dir, "scratch", "demo"))).toEqual({
      packageName: null,
      repoName: null,
      folderName: "demo",
      worktreeName: null,
      rootDir: null,
      branch: null,
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

describe("ProjectInfoReader home folder", () => {
  // A dotfiles repository in home must never name the projects below it.
  function setup() {
    write("home/dev/.git/HEAD", "ref: refs/heads/main\n");
    write("home/dev/shop/package.json", JSON.stringify({ name: "shop" }));
    return path.join(dir, "home", "dev", "shop");
  }

  it("stops at home spelled in another case where file names ignore case", () => {
    const cwd = setup();
    const home = path.join(dir, "HOME", "Dev");
    expect(new ProjectInfoReader(home, "darwin").read(cwd).repoName).toBeNull();
    expect(new ProjectInfoReader(home, "win32").read(cwd).repoName).toBeNull();
  });

  it("compares case exactly on Linux", () => {
    const cwd = setup();
    expect(new ProjectInfoReader(path.join(dir, "HOME", "Dev"), "linux").read(cwd).repoName).toBe(
      "dev",
    );
  });

  it("stops at home reached through a symlink", () => {
    const cwd = setup();
    const link = path.join(dir, "link-home");
    fs.symlinkSync(path.join(dir, "home", "dev"), link);
    expect(new ProjectInfoReader(link, "linux").read(cwd).repoName).toBeNull();
  });
});
