import { DEFAULT_CONFIG, parseConfig } from "./studio-config.ts";

describe("parseConfig", () => {
  it("starts an HTTP proxy on 1355 by default, which needs no sudo or certificate", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ startProxy: true, proxyPort: 1355, proxyHttps: false });
  });

  it("fills every missing field with its default", () => {
    expect(parseConfig({})).toEqual({ ok: true, value: DEFAULT_CONFIG });
  });

  it("keeps valid values, drops unknown fields and dedupes lists", () => {
    const result = parseConfig({ autoName: true, port: 5000, ignoredPorts: [9, 3, 9], extra: 1 });
    expect(result).toEqual({
      ok: true,
      value: { ...DEFAULT_CONFIG, autoName: true, port: 5000, ignoredPorts: [3, 9] },
    });
  });

  it.each([
    [null, "The config must be a JSON object."],
    [[], "The config must be a JSON object."],
    [{ autoName: "yes" }, '"autoName" must be true or false.'],
    [{ port: 70000 }, '"port" must be a whole number from 1 to 65535.'],
    [{ proxyPort: 0 }, '"proxyPort" must be a whole number from 1 to 65535.'],
    [{ startProxy: 1 }, '"startProxy" must be true or false.'],
    [{ proxyHttps: "no" }, '"proxyHttps" must be true or false.'],
    [{ scanIntervalMs: 10 }, '"scanIntervalMs" must be a whole number of at least 1000.'],
    [{ ignoredPorts: ["80"] }, '"ignoredPorts" must be a list of port numbers.'],
    [{ ignoredProcesses: [1] }, '"ignoredProcesses" must be a list of process names.'],
  ])("rejects %j", (input, error) => {
    expect(parseConfig(input)).toEqual({ ok: false, error });
  });
});

describe("parseConfig views and favorites", () => {
  const view = {
    id: "backends",
    name: "Backends",
    groupBy: "custom",
    sort: { by: "port", direction: "desc" },
    filters: { kinds: ["app"], projects: ["acme-monorepo"], statuses: ["up"] },
    customGroups: [{ id: "g1", name: "APIs", members: ["api.acme", "port:4000"] }],
  };

  it("defaults to one view called All, grouped by project, as the default view", () => {
    const config = parseConfig({});
    expect(config.ok && config.value.views).toEqual([
      {
        id: "all",
        name: "All",
        groupBy: "project",
        sort: { by: "name", direction: "asc" },
        filters: { kinds: [], projects: [], statuses: [] },
      },
    ]);
    expect(config.ok && config.value.defaultViewId).toBe("all");
    expect(config.ok && config.value.favorites).toEqual([]);
  });

  it("keeps an old config without views valid", () => {
    const config = parseConfig({ autoName: true, port: 5000 });
    expect(config.ok && config.value.views.map((item) => item.id)).toEqual(["all"]);
  });

  it("keeps saved views, the default view and favorites", () => {
    const result = parseConfig({
      views: [DEFAULT_CONFIG.views[0], view],
      defaultViewId: "backends",
      favorites: ["web.acme", "port:3000", "web.acme"],
    });
    expect(result.ok && result.value.views[1]).toEqual(view);
    expect(result.ok && result.value.defaultViewId).toBe("backends");
    expect(result.ok && result.value.favorites).toEqual(["web.acme", "port:3000"]);
  });

  it("fills missing view fields with defaults", () => {
    const result = parseConfig({ views: [{ id: "mine", name: "Mine" }], defaultViewId: "mine" });
    expect(result.ok && result.value.views[0]).toEqual({
      id: "mine",
      name: "Mine",
      groupBy: "project",
      sort: { by: "name", direction: "asc" },
      filters: { kinds: [], projects: [], statuses: [] },
    });
  });

  it("falls back to the first view when the default view id is missing", () => {
    const result = parseConfig({ views: [view] });
    expect(result.ok && result.value.defaultViewId).toBe("backends");
  });

  it.each([
    [{ views: [] }, '"views" must be a list with at least one view.'],
    [{ views: "all" }, '"views" must be a list with at least one view.'],
    [{ views: [{ name: "x" }] }, '"views[0].id" must be a non-empty text.'],
    [{ views: [{ id: "a", name: " " }] }, '"views[0].name" must be a non-empty text.'],
    [
      {
        views: [
          { id: "a", name: "A" },
          { id: "a", name: "B" },
        ],
      },
      '"views[1].id" repeats another view\'s id.',
    ],
    [
      { views: [{ id: "a", name: "A", groupBy: "color" }] },
      '"views[0].groupBy" must be one of none, project, worktree, kind, status, custom.',
    ],
    [
      { views: [{ id: "a", name: "A", sort: { by: "size" } }] },
      '"views[0].sort.by" must be one of name, port, newest, status.',
    ],
    [
      { views: [{ id: "a", name: "A", sort: { direction: "up" } }] },
      '"views[0].sort.direction" must be one of asc, desc.',
    ],
    [
      { views: [{ id: "a", name: "A", filters: { kinds: ["db"] } }] },
      '"views[0].filters.kinds" must be a list of app, alias, detected.',
    ],
    [
      { views: [{ id: "a", name: "A", filters: { statuses: ["ok"] } }] },
      '"views[0].filters.statuses" must be a list of up, error, down.',
    ],
    [
      { views: [{ id: "a", name: "A", filters: { projects: [1] } }] },
      '"views[0].filters.projects" must be a list of project names.',
    ],
    [
      { views: [{ id: "a", name: "A", customGroups: [{ id: "g", name: "G", members: [3] }] }] },
      '"views[0].customGroups[0].members" must be a list of route names or "port:<number>".',
    ],
    [
      { views: [{ id: "a", name: "A" }], defaultViewId: "b" },
      '"defaultViewId" must be the id of one of the views.',
    ],
    [{ favorites: ["port:abc"] }, '"favorites" must be a list of route names or "port:<number>".'],
  ])("rejects %j", (input, error) => {
    expect(parseConfig(input)).toEqual({ ok: false, error });
  });
});
