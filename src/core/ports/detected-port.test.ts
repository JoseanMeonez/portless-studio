import { projectOf, suggestName } from "./detected-port.ts";

const info = (
  packageName: string | null,
  repoName: string | null,
  folderName: string | null = null,
  worktreeName: string | null = null,
  branch: string | null = null,
) => ({ packageName, repoName, folderName, worktreeName, branch });

describe("suggestName", () => {
  it("joins the package and the repository", () => {
    expect(suggestName(info("@acme/web", "acme-monorepo"))).toBe("web.acme-monorepo");
  });

  it("uses the repository alone when the package has its name", () => {
    expect(suggestName(info("portless-studio", "portless-studio"))).toBe("portless-studio");
  });

  it("prefixes the worktree so two checkouts of one app get different names", () => {
    expect(suggestName(info("@acme/web", "acme-monorepo", "web", "falcon"))).toBe(
      "falcon.web.acme-monorepo",
    );
  });

  it("falls back to whatever is known", () => {
    expect(suggestName(info("app", null))).toBe("app");
    expect(suggestName(info(null, "shop-admin"))).toBe("shop-admin");
    expect(suggestName(info(null, null, "My Project"))).toBe("my-project");
  });

  it("puts a ticket key from the branch first and shortens the repository", () => {
    expect(suggestName(info("@acme/web", "acme-monorepo", "web", null, "feat/ED-1234-add-x"))).toBe(
      "ed-1234.web.acme",
    );
    expect(suggestName(info("shop-admin", "shop-admin-repo", null, "falcon", "dev/run-51"))).toBe(
      "run-51.shop-admin",
    );
  });

  it("uses the last segment of a branch without a ticket key", () => {
    expect(suggestName(info("@acme/web", "acme-monorepo", "web", "falcon", "feat/Dark_Mode"))).toBe(
      "dark-mode.web.acme",
    );
  });

  it("keeps the old name on the default branch or a detached HEAD", () => {
    for (const branch of ["main", "master", "develop", null]) {
      expect(suggestName(info("@acme/web", "acme-monorepo", "web", "falcon", branch))).toBe(
        "falcon.web.acme-monorepo",
      );
    }
  });

  it("keeps every label of a long branch name under 63 characters", () => {
    const name = suggestName(info("web", "acme", null, null, `feat/${"x".repeat(120)}`));
    expect(name).not.toBeNull();
    for (const label of name?.split(".") ?? []) expect(label.length).toBeLessThanOrEqual(63);
  });

  it("returns null when nothing usable is known", () => {
    expect(suggestName(info(null, null, null))).toBeNull();
    expect(suggestName(info("@@@", null))).toBeNull();
  });
});

describe("projectOf", () => {
  const info = { packageName: null, repoName: null, folderName: "tmp", worktreeName: null };

  it("uses the repository and the linked worktree", () => {
    expect(projectOf({ ...info, repoName: "acme-monorepo", worktreeName: "falcon" })).toEqual({
      name: "acme-monorepo",
      worktree: "falcon",
    });
  });

  it("falls back to the package name, and to null for a loose folder", () => {
    expect(projectOf({ ...info, packageName: "@acme/api" })).toEqual({
      name: "@acme/api",
      worktree: null,
    });
    expect(projectOf(info)).toBeNull();
  });
});
