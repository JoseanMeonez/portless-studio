import { suggestName } from "./detected-port.ts";
import { DEFAULT_NAME_TEMPLATE, parseNameTemplate } from "./name-template.ts";

const example = {
  packageName: "@acme/web",
  repoName: "acme-monorepo",
  folderName: "web",
  worktreeName: "falcon",
  branch: "feat/ED-1234-add-login",
};

describe("suggestName with a template", () => {
  it("defaults to {work}.{package}.{repo}", () => {
    expect(DEFAULT_NAME_TEMPLATE).toBe("{work}.{package}.{repo}");
    expect(suggestName(example, DEFAULT_NAME_TEMPLATE)).toBe(suggestName(example));
  });

  it("renders every token", () => {
    const render = (template: string, info = example) => suggestName(info, template, 5173);
    expect(render("{work}.{repo}")).toBe("ed-1234.acme");
    expect(render("{branch}.{repo}")).toBe("feat-ed-1234-add-login.acme");
    expect(render("{ticket}.{repo}")).toBe("ed-1234.acme");
    expect(render("{package}")).toBe("web");
    expect(render("{worktree}.{repo}")).toBe("falcon.acme");
    expect(render("{folder}")).toBe("web");
    expect(render("{package}-{port}")).toBe("web-5173");
    expect(render("{work}.{repo}", { ...example, branch: "feat/dark-mode" })).toBe(
      "dark-mode.acme",
    );
  });

  it("drops empty segments and the dots around them", () => {
    const onMain = { ...example, branch: "main", worktreeName: null };
    expect(suggestName(onMain, "{ticket}.{package}.{repo}")).toBe("web.acme-monorepo");
    expect(suggestName(onMain, "{package}.{ticket}.{repo}")).toBe("web.acme-monorepo");
    expect(suggestName({ ...onMain, packageName: null }, "{package}-{port}", 3000)).toBe("3000");
  });

  it("keeps one of two equal adjacent labels", () => {
    expect(suggestName({ ...example, packageName: "acme" }, "{work}.{package}.{repo}")).toBe(
      "ed-1234.acme",
    );
  });

  it("keeps each label within 63 characters and returns a valid name", () => {
    const long = { ...example, branch: `feat/${"x".repeat(120)}` };
    const name = suggestName(long, "{branch}.{repo}");
    expect(name).not.toBeNull();
    for (const label of name?.split(".") ?? []) expect(label.length).toBeLessThanOrEqual(63);
  });

  it("returns null when no label names the app", () => {
    const unknown = { packageName: null, repoName: null, folderName: null, worktreeName: null };
    expect(suggestName({ ...unknown, branch: "feat/x" }, "{work}.{package}.{repo}")).toBeNull();
    expect(suggestName(example, "{package}.{repo}")).toBe("web.acme");
  });
});

describe("parseNameTemplate", () => {
  it("accepts known tokens and literal text", () => {
    expect(parseNameTemplate("{ticket}.{repo}").ok).toBe(true);
    expect(parseNameTemplate("dev.{package}-{port}").ok).toBe(true);
  });

  it("names an unknown token", () => {
    const result = parseNameTemplate("{work}.{projct}");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("{projct}");
  });

  it("rejects a template without a token that names the app", () => {
    expect(parseNameTemplate("{work}").ok).toBe(false);
    expect(parseNameTemplate("").ok).toBe(false);
  });

  it("rejects an unclosed brace and characters a name cannot hold", () => {
    expect(parseNameTemplate("{repo").ok).toBe(false);
    expect(parseNameTemplate("{repo}/{package}").ok).toBe(false);
  });
});
