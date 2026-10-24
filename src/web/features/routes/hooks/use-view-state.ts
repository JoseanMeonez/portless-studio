import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_VIEW,
  GROUP_BY_OPTIONS,
  ITEM_KINDS,
  ITEM_STATUSES,
  SORT_BY_OPTIONS,
  type SortDirection,
  type View,
  type ViewFilters,
  type ViewGroupBy,
  type ViewSort,
} from "../../../../core/views/view.ts";

/** Query parameters that change the current view without saving it. */
const OVERRIDES = ["group", "sort", "dir", "kind", "project", "status"] as const;

/**
 * The current view and the changes made to it, kept in the URL (`?view=…&q=…&kind=…&sort=…`) so
 * reload, links and back/forward all keep them. Saved views come from the config.
 */
export function useViewState(views: readonly View[], defaultViewId: string) {
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const follow = () => setSearch(window.location.search);
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const saved =
    views.find((view) => view.id === params.get("view")) ??
    views.find((view) => view.id === defaultViewId) ??
    views[0] ??
    DEFAULT_VIEW;
  const view = useMemo(() => applyOverrides(saved, params), [saved, params]);
  const modified = OVERRIDES.some((name) => params.has(name));
  const query = params.get("q") ?? "";

  /** Typing replaces the history entry; every other change adds one, so Back undoes it. */
  const write = (change: (next: URLSearchParams) => void, mode: "push" | "replace" = "push") => {
    const next = new URLSearchParams(window.location.search);
    change(next);
    const text = next.toString();
    const url = `${window.location.pathname}${text ? `?${text}` : ""}${window.location.hash}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setSearch(window.location.search);
  };

  const setOrClear = (next: URLSearchParams, name: string, value: string, same: boolean) => {
    if (same) next.delete(name);
    else next.set(name, value);
  };

  return {
    /** The saved view with the URL's changes applied: what the list shows. */
    view,
    /** The view as saved in the config. */
    saved,
    /** True when the URL changes the saved view. */
    modified,
    query,
    setQuery: (value: string) =>
      write((next) => setOrClear(next, "q", value, value === ""), "replace"),
    switchView: (id: string) =>
      write((next) => {
        setOrClear(next, "view", id, id === defaultViewId);
        for (const name of OVERRIDES) next.delete(name);
      }),
    setGroupBy: (groupBy: ViewGroupBy) =>
      write((next) => setOrClear(next, "group", groupBy, groupBy === saved.groupBy)),
    setSort: (sort: ViewSort) =>
      write((next) => {
        setOrClear(next, "sort", sort.by, sort.by === saved.sort.by);
        setOrClear(next, "dir", sort.direction, sort.direction === saved.sort.direction);
      }),
    setFilters: (filters: ViewFilters) =>
      write((next) => {
        const fields = [
          ["kind", filters.kinds, saved.filters.kinds],
          ["project", filters.projects, saved.filters.projects],
          ["status", filters.statuses, saved.filters.statuses],
        ] as const;
        for (const [name, value, original] of fields) {
          setOrClear(next, name, value.join(","), sameItems(value, original));
        }
      }),
    /** Drops the URL's changes and shows the view as saved. */
    resetChanges: () =>
      write((next) => {
        for (const name of OVERRIDES) next.delete(name);
      }),
  };
}

export type ViewState = ReturnType<typeof useViewState>;

/** Reads the URL's changes over a saved view; values the app does not know are ignored. */
export function applyOverrides(saved: View, params: URLSearchParams): View {
  const group = params.get("group");
  const by = params.get("sort");
  const direction = params.get("dir");
  const list = <T extends string>(name: string, allowed: readonly T[] | null, fallback: T[]) => {
    const value = params.get(name);
    if (value === null) return fallback;
    const items = value.split(",").filter(Boolean);
    return (allowed ? items.filter((item) => allowed.includes(item as T)) : items) as T[];
  };
  return {
    ...saved,
    groupBy: oneOf(group, GROUP_BY_OPTIONS) ?? saved.groupBy,
    sort: {
      by: oneOf(by, SORT_BY_OPTIONS) ?? saved.sort.by,
      direction: oneOf(direction, ["asc", "desc"] as SortDirection[]) ?? saved.sort.direction,
    },
    filters: {
      kinds: list("kind", ITEM_KINDS, saved.filters.kinds),
      projects: list("project", null, saved.filters.projects),
      statuses: list("status", ITEM_STATUSES, saved.filters.statuses),
    },
  };
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && allowed.includes(value as T) ? (value as T) : null;
}

function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item) => b.includes(item));
}
