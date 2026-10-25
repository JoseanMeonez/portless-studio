import { envEntries, envKey, envLines, selectEnvRoutes } from "./env-lines.ts";

const routes = [
  { name: "web.acme", url: "http://web.acme.localhost", port: 5173 },
  { name: "api.acme", url: "http://api.acme.localhost", port: 4000 },
  { name: "docs", url: "http://docs.localhost:1355", port: 3001 },
];

describe("envKey", () => {
  it("uppercases the name, turns other characters into _ and adds _URL", () => {
    expect(envKey("api.acme")).toBe("API_ACME_URL");
    expect(envKey("pr-87.web.my-app")).toBe("PR_87_WEB_MY_APP_URL");
  });

  it("drops the strip suffix, with or without its leading dot", () => {
    expect(envKey("api.acme", { strip: "acme" })).toBe("API_URL");
    expect(envKey("api.acme", { strip: ".acme" })).toBe("API_URL");
    expect(envKey("api.other", { strip: "acme" })).toBe("API_OTHER_URL");
  });

  it("keeps a name that is the strip suffix itself", () => {
    expect(envKey("acme", { strip: "acme" })).toBe("ACME_URL");
  });

  it("puts the prefix in front, adding the _ it lacks", () => {
    expect(envKey("api.acme", { prefix: "VITE_" })).toBe("VITE_API_ACME_URL");
    expect(envKey("api.acme", { prefix: "NEXT_PUBLIC" })).toBe("NEXT_PUBLIC_API_ACME_URL");
  });

  it("starts a key that would begin with a digit with _", () => {
    expect(envKey("87.web")).toBe("_87_WEB_URL");
  });
});

describe("selectEnvRoutes", () => {
  it("keeps every route when no name is given", () => {
    expect(selectEnvRoutes(routes, [])).toEqual({ ok: true, value: routes });
  });

  it("matches a name exactly and every route that ends with .<name>", () => {
    const selected = selectEnvRoutes(routes, ["acme"]);
    expect(selected.ok && selected.value.map((route) => route.name)).toEqual([
      "web.acme",
      "api.acme",
    ]);
    const exact = selectEnvRoutes(routes, ["docs"]);
    expect(exact.ok && exact.value.map((route) => route.name)).toEqual(["docs"]);
  });

  it("says which names match no route", () => {
    expect(selectEnvRoutes(routes, ["acme", "shop"])).toEqual({
      ok: false,
      error: 'No route matches "shop".',
    });
  });
});

describe("envLines", () => {
  it("prints KEY=url sorted by route name", () => {
    expect(envLines(routes)).toEqual({
      ok: true,
      value: [
        "API_ACME_URL=http://api.acme.localhost",
        "DOCS_URL=http://docs.localhost:1355",
        "WEB_ACME_URL=http://web.acme.localhost",
      ],
    });
  });

  it("uses http://localhost:<port> with direct", () => {
    expect(envLines(routes, { direct: true, strip: "acme", prefix: "VITE_" })).toEqual({
      ok: true,
      value: [
        "VITE_API_URL=http://localhost:4000",
        "VITE_DOCS_URL=http://localhost:3001",
        "VITE_WEB_URL=http://localhost:5173",
      ],
    });
  });

  it("quotes a value only when it needs it", () => {
    const odd = [{ name: "odd", url: 'http://odd.localhost/a b#"c"', port: 1 }];
    expect(envLines(odd)).toEqual({
      ok: true,
      value: ['ODD_URL="http://odd.localhost/a b#\\"c\\""'],
    });
  });

  it("rejects a prefix that is not a variable name", () => {
    expect(envLines(routes, { prefix: "1-bad" })).toEqual({
      ok: false,
      error: 'The prefix "1-bad" must use letters, digits and _, and not start with a digit.',
    });
  });

  it("refuses two routes that would get the same key", () => {
    const clash = [
      { name: "api-acme", url: "http://api-acme.localhost", port: 1 },
      { name: "api.acme", url: "http://api.acme.localhost", port: 2 },
    ];
    expect(envLines(clash)).toEqual({
      ok: false,
      error:
        "api-acme and api.acme both become API_ACME_URL. Pass only one of them, or change the strip suffix.",
    });
  });

  it("returns the entries with their route for the page", () => {
    const entries = envEntries([routes[1] as (typeof routes)[number]], { strip: "acme" });
    expect(entries).toEqual({
      ok: true,
      value: [{ name: "api.acme", key: "API_URL", value: "http://api.acme.localhost" }],
    });
  });
});
