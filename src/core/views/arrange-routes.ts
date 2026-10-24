import type { Route, RouteHealthState } from "../routes/route.ts";
import { itemStatus, keyMatchesRoute, type View } from "./view.ts";

/** One block of rows under a header. `label` is empty when the view does not group. */
export type RouteGroup = {
  /** Stable within a view, used to remember which groups are collapsed. */
  key: string;
  label: string;
  routes: Route[];
  /** Set for custom groups, so the header can rename or delete them. */
  customGroupId?: string;
};

export type Arrangement = {
  /** Favorite routes the filters keep, pinned above every group. */
  favorites: Route[];
  groups: RouteGroup[];
  /** How many routes the filters keep, favorites included. */
  matched: number;
};

const NO_PROJECT = "No project";
const KIND_GROUPS = [
  { key: "app", label: "Apps" },
  { key: "alias", label: "Aliases" },
] as const;
const STATUS_ORDER: readonly (RouteHealthState | "unknown")[] = ["up", "error", "down", "unknown"];
const STATUS_LABELS = { up: "Up", error: "Errors", down: "Down", unknown: "Unknown" } as const;

/**
 * Applies a view to the routes: filters them, sorts them, pins favorites on top and splits the
 * rest into groups. Pure, so every rule is tested with plain objects.
 */
export function arrangeRoutes(
  routes: readonly Route[],
  view: View,
  favorites: readonly string[],
): Arrangement {
  const kept = sortRoutes(
    routes.filter((route) => passesFilters(route, view)),
    view.sort,
  );
  const isFavorite = (route: Route) => favorites.some((key) => keyMatchesRoute(key, route));
  const pinned = kept.filter(isFavorite);
  const rest = kept.filter((route) => !isFavorite(route));
  return { favorites: pinned, groups: groupRoutes(rest, view), matched: kept.length };
}

function passesFilters(route: Route, view: View): boolean {
  const { kinds, projects, statuses } = view.filters;
  if (kinds.length > 0 && !kinds.includes(route.kind)) return false;
  if (projects.length > 0 && !projects.includes(route.project?.name ?? "")) return false;
  const status = itemStatus(route);
  if (statuses.length > 0 && (status === null || !statuses.includes(status))) return false;
  return true;
}

/**
 * `name`: apps first, then aliases, each alphabetical. `newest`: most recently registered first.
 * `status`: up, errors, down, then routes not probed yet. `desc` reverses the whole order.
 */
export function sortRoutes(routes: readonly Route[], sort: View["sort"]): Route[] {
  const byName = (a: Route, b: Route) => a.name.localeCompare(b.name);
  const kindRank = (route: Route) => (route.kind === "app" ? 0 : 1);
  const statusRank = (route: Route) => STATUS_ORDER.indexOf(itemStatus(route) ?? "unknown");
  const compare: Record<View["sort"]["by"], (a: Route, b: Route) => number> = {
    name: (a, b) => kindRank(a) - kindRank(b) || byName(a, b),
    port: (a, b) => a.port - b.port || byName(a, b),
    newest: (a, b) => (b.registeredAt ?? -1) - (a.registeredAt ?? -1) || byName(a, b),
    status: (a, b) => statusRank(a) - statusRank(b) || byName(a, b),
  };
  const sorted = [...routes].sort(compare[sort.by]);
  return sort.direction === "desc" ? sorted.reverse() : sorted;
}

function groupRoutes(routes: Route[], view: View): RouteGroup[] {
  switch (view.groupBy) {
    case "none":
      return routes.length > 0 ? [{ key: "all", label: "", routes }] : [];
    case "project":
      return byLabel(routes, (route) => route.project?.name ?? null);
    case "worktree":
      return byLabel(routes, (route) =>
        route.project
          ? route.project.worktree
            ? `${route.project.name} / ${route.project.worktree}`
            : route.project.name
          : null,
      );
    case "kind":
      return KIND_GROUPS.map(({ key, label }) => ({
        key,
        label,
        routes: routes.filter((route) => route.kind === key),
      })).filter((group) => group.routes.length > 0);
    case "status":
      return STATUS_ORDER.map((status) => ({
        key: status,
        label: STATUS_LABELS[status],
        routes: routes.filter((route) => (itemStatus(route) ?? "unknown") === status),
      })).filter((group) => group.routes.length > 0);
    case "custom":
      return customGroups(routes, view);
  }
}

/** Groups named by `labelOf`, alphabetical, with the routes it cannot label last. */
function byLabel(routes: Route[], labelOf: (route: Route) => string | null): RouteGroup[] {
  const groups = new Map<string, Route[]>();
  for (const route of routes) {
    const label = labelOf(route) ?? NO_PROJECT;
    groups.set(label, [...(groups.get(label) ?? []), route]);
  }
  const labels = [...groups.keys()].sort((a, b) =>
    a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : a.localeCompare(b),
  );
  return labels.map((label) => ({ key: label, label, routes: groups.get(label) ?? [] }));
}

/** Custom groups in the order they were made, empty ones included, then "Ungrouped". */
function customGroups(routes: Route[], view: View): RouteGroup[] {
  const placed = new Set<Route>();
  const groups: RouteGroup[] = (view.customGroups ?? []).map((group) => {
    const members = routes.filter(
      (route) => !placed.has(route) && group.members.some((key) => keyMatchesRoute(key, route)),
    );
    for (const route of members) placed.add(route);
    return {
      key: `custom:${group.id}`,
      label: group.name,
      routes: members,
      customGroupId: group.id,
    };
  });
  const ungrouped = routes.filter((route) => !placed.has(route));
  if (ungrouped.length > 0)
    groups.push({ key: "ungrouped", label: "Ungrouped", routes: ungrouped });
  return groups;
}
