import { err, ok, type Result } from "../result.ts";
import type { Route, RouteHealthState } from "../routes/route.ts";

/** What a row in the dashboard is: a portless app, a hand-made alias or an unnamed port. */
export type ItemKind = "app" | "alias" | "detected";

export type ViewGroupBy = "none" | "project" | "worktree" | "kind" | "status" | "custom";

export type ViewSortBy = "name" | "port" | "newest" | "status";

export type SortDirection = "asc" | "desc";

export type ViewSort = { by: ViewSortBy; direction: SortDirection };

/** An empty list means "no filter" for that field. */
export type ViewFilters = {
  kinds: ItemKind[];
  /** Project names, as `ItemProject.name`. */
  projects: string[];
  statuses: RouteHealthState[];
};

/** A group the person makes by hand. Members are route names or `port:<number>`. */
export type CustomGroup = { id: string; name: string; members: string[] };

/** A saved way to look at the list: how rows are grouped, sorted and filtered. */
export type View = {
  id: string;
  name: string;
  groupBy: ViewGroupBy;
  sort: ViewSort;
  filters: ViewFilters;
  /** Groups used when `groupBy` is `custom`. */
  customGroups?: CustomGroup[];
};

export const GROUP_BY_OPTIONS: readonly ViewGroupBy[] = [
  "none",
  "project",
  "worktree",
  "kind",
  "status",
  "custom",
];
export const SORT_BY_OPTIONS: readonly ViewSortBy[] = ["name", "port", "newest", "status"];
export const ITEM_KINDS: readonly ItemKind[] = ["app", "alias", "detected"];
export const ITEM_STATUSES: readonly RouteHealthState[] = ["up", "error", "down"];
const DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

export const EMPTY_FILTERS: ViewFilters = { kinds: [], projects: [], statuses: [] };

/** The view every config starts with. */
export const DEFAULT_VIEW: View = {
  id: "all",
  name: "All",
  groupBy: "project",
  sort: { by: "name", direction: "asc" },
  filters: EMPTY_FILTERS,
};

const PORT_KEY = /^port:([1-9]\d{0,4})$/;

/** Favorites and custom groups refer to a route by its name. */
export function routeKey(route: Pick<Route, "name">): string {
  return route.name;
}

/** ...or to whatever serves a port, by `port:<number>`. */
export function portKey(port: number): string {
  return `port:${port}`;
}

/** True when `key` (a route name or `port:<n>`) points at this route. */
export function keyMatchesRoute(key: string, route: Pick<Route, "name" | "port">): boolean {
  return key === route.name || key === portKey(route.port);
}

/** The route's state from its last probe, or null before the first probe. */
export function itemStatus(route: Pick<Route, "health">): RouteHealthState | null {
  return route.health?.state ?? null;
}

/** True when the view's filters narrow anything. */
export function hasFilters(filters: ViewFilters): boolean {
  return filters.kinds.length + filters.projects.length + filters.statuses.length > 0;
}

/** Valid item keys: anything non-empty except a malformed `port:` key. */
export function isItemKey(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 253) return false;
  return !value.startsWith("port:") || PORT_KEY.test(value);
}

/** Reads `views` from untrusted JSON; errors name the exact field, like `"views[0].name"`. */
export function parseViews(input: unknown): Result<View[], string> {
  if (!Array.isArray(input) || input.length === 0) {
    return err(`"views" must be a list with at least one view.`);
  }
  const views: View[] = [];
  for (const [index, item] of input.entries()) {
    const view = parseView(item, `views[${index}]`);
    if (!view.ok) return view;
    if (views.some((other) => other.id === view.value.id)) {
      return err(`"views[${index}].id" repeats another view's id.`);
    }
    views.push(view.value);
  }
  return ok(views);
}

function parseView(input: unknown, field: string): Result<View, string> {
  if (!isRecord(input)) return err(`"${field}" must be an object.`);
  const id = text(input.id);
  if (id === null) return err(`"${field}.id" must be a non-empty text.`);
  const name = text(input.name);
  if (name === null) return err(`"${field}.name" must be a non-empty text.`);

  const groupBy = oneOf(input.groupBy, GROUP_BY_OPTIONS, DEFAULT_VIEW.groupBy);
  if (groupBy === null) return err(`"${field}.groupBy" must be one of ${list(GROUP_BY_OPTIONS)}.`);

  const sortInput = input.sort === undefined ? {} : input.sort;
  if (!isRecord(sortInput)) return err(`"${field}.sort" must be an object.`);
  const by = oneOf(sortInput.by, SORT_BY_OPTIONS, DEFAULT_VIEW.sort.by);
  if (by === null) return err(`"${field}.sort.by" must be one of ${list(SORT_BY_OPTIONS)}.`);
  const direction = oneOf(sortInput.direction, DIRECTIONS, DEFAULT_VIEW.sort.direction);
  if (direction === null)
    return err(`"${field}.sort.direction" must be one of ${list(DIRECTIONS)}.`);

  const filters = parseFilters(input.filters, `${field}.filters`);
  if (!filters.ok) return filters;

  const view: View = { id, name, groupBy, sort: { by, direction }, filters: filters.value };
  if (input.customGroups !== undefined) {
    const groups = parseCustomGroups(input.customGroups, `${field}.customGroups`);
    if (!groups.ok) return groups;
    view.customGroups = groups.value;
  }
  return ok(view);
}

function parseFilters(input: unknown, field: string): Result<ViewFilters, string> {
  if (input === undefined) return ok({ kinds: [], projects: [], statuses: [] });
  if (!isRecord(input)) return err(`"${field}" must be an object.`);
  const kinds = subset(input.kinds, ITEM_KINDS);
  if (kinds === null) return err(`"${field}.kinds" must be a list of ${list(ITEM_KINDS)}.`);
  const statuses = subset(input.statuses, ITEM_STATUSES);
  if (statuses === null)
    return err(`"${field}.statuses" must be a list of ${list(ITEM_STATUSES)}.`);
  const projects = input.projects ?? [];
  if (!Array.isArray(projects) || !projects.every((item) => text(item) !== null)) {
    return err(`"${field}.projects" must be a list of project names.`);
  }
  return ok({ kinds, projects: unique(projects.map((item) => item.trim())), statuses });
}

function parseCustomGroups(input: unknown, field: string): Result<CustomGroup[], string> {
  if (!Array.isArray(input)) return err(`"${field}" must be a list of groups.`);
  const groups: CustomGroup[] = [];
  for (const [index, item] of input.entries()) {
    const at = `${field}[${index}]`;
    if (!isRecord(item)) return err(`"${at}" must be an object.`);
    const id = text(item.id);
    if (id === null) return err(`"${at}.id" must be a non-empty text.`);
    if (groups.some((group) => group.id === id)) return err(`"${at}.id" repeats another group.`);
    const name = text(item.name);
    if (name === null) return err(`"${at}.name" must be a non-empty text.`);
    const members = item.members ?? [];
    if (!Array.isArray(members) || !members.every(isItemKey)) {
      return err(`"${at}.members" must be a list of route names or "port:<number>".`);
    }
    groups.push({ id, name, members: unique(members) });
  }
  return ok(groups);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** The value when allowed, the fallback when absent, null when wrong. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T | null {
  if (value === undefined) return fallback;
  return allowed.includes(value as T) ? (value as T) : null;
}

function subset<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => allowed.includes(item))) return null;
  return unique(value as T[]);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function list(values: readonly string[]): string {
  return values.join(", ");
}
