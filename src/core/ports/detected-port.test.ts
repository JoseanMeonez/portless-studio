import { suggestName } from "./detected-port.ts";

const info = (
  packageName: string | null,
  repoName: string | null,
  folderName: string | null = null,
) => ({ packageName, repoName, folderName });

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

  it("returns null when nothing usable is known", () => {
    expect(suggestName(info(null, null, null))).toBeNull();
    expect(suggestName(info("@@@", null))).toBeNull();
  });
});
