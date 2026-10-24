import { itemProjectAt } from "./item-project.ts";

const base = { packageName: null, repoName: null, folderName: "web", worktreeName: null };

describe("itemProjectAt", () => {
  it("adds the branch and the repository folder to the project", () => {
    const info = {
      ...base,
      repoName: "acme",
      worktreeName: "falcon",
      rootDir: "/home/dev/code/acme-falcon",
      branch: "feat/ED-12-dark-mode",
    };
    expect(itemProjectAt(info, "/home/dev/code/acme-falcon/apps/web")).toEqual({
      name: "acme",
      worktree: "falcon",
      branch: "feat/ED-12-dark-mode",
      path: "/home/dev/code/acme-falcon",
    });
  });

  it("falls back to the process folder when the root is unknown", () => {
    expect(itemProjectAt({ ...base, packageName: "web" }, "/srv/web")).toEqual({
      name: "web",
      worktree: null,
      branch: null,
      path: "/srv/web",
    });
  });

  it("gives no project for a loose folder", () => {
    expect(itemProjectAt(base, "/tmp/web")).toBeNull();
  });
});
