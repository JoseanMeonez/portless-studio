import { fuzzyFilter, fuzzyScore } from "./fuzzy-match.ts";

describe("fuzzyScore", () => {
  it("matches letters in order and rejects letters out of order", () => {
    expect(fuzzyScore("wm", "web.acme")).not.toBeNull();
    expect(fuzzyScore("rw", "web")).toBeNull();
  });

  it("ranks a substring above a scattered match", () => {
    const substring = fuzzyScore("api", "api.acme") ?? 0;
    const scattered = fuzzyScore("api", "a-p-i") ?? 0;
    expect(substring).toBeGreaterThan(scattered);
  });
});

describe("fuzzyFilter", () => {
  it("returns every item for an empty query, in the original order", () => {
    expect(fuzzyFilter(["b", "a"], " ", (item) => item)).toEqual(["b", "a"]);
  });

  it("drops items that do not match and puts the best match first", () => {
    const names = ["docs", "api.acme", "web.acme"];
    expect(fuzzyFilter(names, "acm", (item) => item)).toEqual(["api.acme", "web.acme"]);
    expect(fuzzyFilter(names, "web", (item) => item)[0]).toBe("web.acme");
  });
});
