import { useMemo, useState } from "react";
import type { Route } from "../../../../core/routes/route.ts";

export type SortOrder = "name" | "newest";

/** The filter text and sort order, and the routes they leave visible. */
export function useFilter(routes: readonly Route[]) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOrder>("name");
  const visible = useMemo(
    () => sortRoutes(filterRoutes(routes, query), sort),
    [routes, query, sort],
  );
  return { query, setQuery, sort, setSort, visible };
}

/** Every word of the query must appear in the name, URL, port or kind. */
export function filterRoutes(routes: readonly Route[], query: string): Route[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...routes];
  return routes.filter((route) => {
    const text = `${route.name} ${route.url} ${route.port} ${route.kind}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** `name`: apps first, then aliases, each alphabetical. `newest`: most recently registered first. */
export function sortRoutes(routes: readonly Route[], order: SortOrder): Route[] {
  const byName = (a: Route, b: Route) => a.name.localeCompare(b.name);
  if (order === "newest") {
    return [...routes].sort(
      (a, b) => (b.registeredAt ?? -1) - (a.registeredAt ?? -1) || byName(a, b),
    );
  }
  const kindRank = (route: Route) => (route.kind === "app" ? 0 : 1);
  return [...routes].sort((a, b) => kindRank(a) - kindRank(b) || byName(a, b));
}
