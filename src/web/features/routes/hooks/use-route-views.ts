import { useMemo } from "react";
import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import type { Route } from "../../../../core/routes/route.ts";
import { arrangeRoutes } from "../../../../core/views/arrange-routes.ts";
import { keyMatchesRoute, type View } from "../../../../core/views/view.ts";
import type { RouteSection } from "../components/route-list.tsx";
import { useCollapsedGroups } from "./use-collapsed-groups.ts";
import { filterDetected, filterRoutes } from "./use-filter.ts";
import { useViewState } from "./use-view-state.ts";
import { useViewsConfig } from "./use-views-config.ts";

export const FAVORITES_SECTION = "favorites";

/**
 * Everything the list shows for the current view: saved views and favorites from the config,
 * the view's changes and search from the URL, collapsed groups from this browser, and the rows
 * in the order the keyboard walks them.
 */
export function useRouteViews(routes: readonly Route[], detected: readonly DetectedPort[]) {
  const config = useViewsConfig();
  const state = useViewState(config.views, config.defaultViewId);
  const collapsed = useCollapsedGroups(state.saved.id);
  const { view, query } = state;

  const arrangement = useMemo(
    () => arrangeRoutes(filterRoutes(routes, query), view, config.favorites),
    [routes, query, view, config.favorites],
  );

  const sections = useMemo((): RouteSection[] => {
    const groups: RouteSection[] = arrangement.groups.map((group) =>
      // Without grouping the rows need a heading only to set them apart from favorites.
      group.label === "" && arrangement.favorites.length > 0
        ? { ...group, label: "Others" }
        : group,
    );
    if (arrangement.favorites.length === 0) return groups;
    return [
      { key: FAVORITES_SECTION, label: "Favorites", routes: arrangement.favorites },
      ...groups,
    ];
  }, [arrangement]);

  // The rows the keyboard walks: what is on screen, top to bottom.
  const ordered = useMemo(
    () =>
      sections.flatMap((section) =>
        section.label !== "" && collapsed.isCollapsed(section.key) ? [] : section.routes,
      ),
    [sections, collapsed],
  );

  const visibleDetected = useMemo(
    () => detectedForView(filterDetected(detected, query), view),
    [detected, query, view],
  );

  const projects = useMemo(() => {
    const names = [...routes, ...detected].flatMap((item) =>
      item.project ? [item.project.name] : [],
    );
    return [...new Set([...names, ...view.filters.projects])].sort((a, b) => a.localeCompare(b));
  }, [routes, detected, view.filters.projects]);

  const isFavorite = (route: Route) => config.favorites.some((key) => keyMatchesRoute(key, route));

  return {
    config,
    state,
    sections,
    ordered,
    matched: arrangement.matched,
    visibleDetected,
    projects,
    collapsed,
    isFavorite,
  };
}

/** Detected ports have no kind of their own beyond "detected" and always answer HTTP. */
function detectedForView(detected: DetectedPort[], view: View): DetectedPort[] {
  const { kinds, projects, statuses } = view.filters;
  if (kinds.length > 0 && !kinds.includes("detected")) return [];
  if (statuses.length > 0 && !statuses.includes("up")) return [];
  if (projects.length === 0) return detected;
  return detected.filter((item) => item.project && projects.includes(item.project.name));
}
