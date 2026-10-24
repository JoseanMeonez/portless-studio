import type { Route } from "../routes/route.ts";
import { arrangeRoutes } from "./arrange-routes.ts";
import { DEFAULT_VIEW, itemStatus, routeKey, type View } from "./view.ts";

function route(name: string, extra: Partial<Route> = {}): Route {
  return {
    hostname: `${name}.localhost`,
    name,
    port: 3000,
    kind: "app",
    pid: 1,
    registeredAt: 0,
    url: `http://${name}.localhost`,
    tunnels: [],
    ...extra,
  };
}

const acme = (worktree: string | null) => ({ name: "acme-monorepo", worktree });

const ROUTES: Route[] = [
  route("web", { port: 3000, project: acme("falcon"), health: { state: "up", checkedAt: 0 } }),
  route("api", { port: 4000, project: acme(null), registeredAt: 5 }),
  route("admin", {
    port: 4209,
    project: { name: "shop-admin", worktree: "otter" },
    health: { state: "error", checkedAt: 0 },
  }),
  route("db", { port: 5432, kind: "alias", pid: null, project: null }),
];

const view = (change: Partial<View>): View => ({ ...DEFAULT_VIEW, ...change });
const names = (routes: readonly Route[]) => routes.map((item) => item.name);

describe("arrangeRoutes", () => {
  it("groups by project with a count per group and routes without a project last", () => {
    const result = arrangeRoutes(ROUTES, view({ groupBy: "project" }), []);
    expect(result.groups.map((group) => [group.label, names(group.routes)])).toEqual([
      ["acme-monorepo", ["api", "web"]],
      ["shop-admin", ["admin"]],
      ["No project", ["db"]],
    ]);
  });

  it("groups by worktree, labelling linked worktrees after their project", () => {
    const result = arrangeRoutes(ROUTES, view({ groupBy: "worktree" }), []);
    expect(result.groups.map((group) => group.label)).toEqual([
      "acme-monorepo",
      "acme-monorepo / falcon",
      "shop-admin / otter",
      "No project",
    ]);
  });

  it("groups by kind and by status in a fixed order", () => {
    expect(arrangeRoutes(ROUTES, view({ groupBy: "kind" }), []).groups.map((g) => g.label)).toEqual(
      ["Apps", "Aliases"],
    );
    expect(
      arrangeRoutes(ROUTES, view({ groupBy: "status" }), []).groups.map((g) => g.label),
    ).toEqual(["Up", "Errors", "Unknown"]);
  });

  it("puts every route in one unlabelled group when grouping is off", () => {
    const result = arrangeRoutes(ROUTES, view({ groupBy: "none" }), []);
    expect(result.groups).toHaveLength(1);
    expect(names(result.groups[0]?.routes ?? [])).toEqual(["admin", "api", "web", "db"]);
  });

  it("pins favorites on top, by name or by port, and keeps them out of their groups", () => {
    const result = arrangeRoutes(ROUTES, view({ groupBy: "project" }), ["db", "port:4000"]);
    expect(names(result.favorites)).toEqual(["api", "db"]);
    expect(result.groups.map((group) => group.label)).toEqual(["acme-monorepo", "shop-admin"]);
  });

  it("sorts by port, status and newest, in either direction", () => {
    const sorted = (by: View["sort"]["by"], direction: "asc" | "desc") =>
      names(
        arrangeRoutes(ROUTES, view({ groupBy: "none", sort: { by, direction } }), []).groups[0]
          ?.routes ?? [],
      );
    expect(sorted("port", "desc")).toEqual(["db", "admin", "api", "web"]);
    expect(sorted("status", "asc")).toEqual(["web", "admin", "api", "db"]);
    expect(sorted("newest", "asc")[0]).toBe("api");
  });

  it("filters by kind, project and status", () => {
    const filtered = (filters: Partial<View["filters"]>) =>
      arrangeRoutes(
        ROUTES,
        view({ groupBy: "none", filters: { ...DEFAULT_VIEW.filters, ...filters } }),
        [],
      ).matched;
    expect(filtered({ kinds: ["alias"] })).toBe(1);
    expect(filtered({ projects: ["acme-monorepo"] })).toBe(2);
    expect(filtered({ statuses: ["up", "error"] })).toBe(2);
  });

  it("lists custom groups in their order, then the routes in none of them", () => {
    const result = arrangeRoutes(
      ROUTES,
      view({
        groupBy: "custom",
        customGroups: [
          { id: "g1", name: "Backends", members: ["api", "port:5432"] },
          { id: "g2", name: "Empty", members: [] },
        ],
      }),
      [],
    );
    expect(result.groups.map((group) => [group.label, names(group.routes)])).toEqual([
      ["Backends", ["api", "db"]],
      ["Empty", []],
      ["Ungrouped", ["admin", "web"]],
    ]);
    expect(result.groups[0]?.customGroupId).toBe("g1");
  });
});

describe("item helpers", () => {
  it("keys a route by its name and reads its status from the last probe", () => {
    expect(routeKey(ROUTES[0] as Route)).toBe("web");
    expect(itemStatus(ROUTES[0] as Route)).toBe("up");
    expect(itemStatus(ROUTES[1] as Route)).toBeNull();
  });
});
