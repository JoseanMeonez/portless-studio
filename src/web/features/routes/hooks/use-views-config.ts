import { useEffect, useState } from "react";
import { DEFAULT_CONFIG, type StudioConfig } from "../../../../core/config/studio-config.ts";
import type { Route } from "../../../../core/routes/route.ts";
import {
  type CustomGroup,
  keyMatchesRoute,
  routeKey,
  type View,
} from "../../../../core/views/view.ts";
import { useToast } from "../../../shared/ui/toast/use-toast.ts";
import { apiErrorMessage } from "./route-messages.ts";
import { useRoutesGateway } from "./routes-gateway-context.tsx";

type ViewsConfig = Pick<StudioConfig, "views" | "defaultViewId" | "favorites">;

const INITIAL: ViewsConfig = {
  views: DEFAULT_CONFIG.views,
  defaultViewId: DEFAULT_CONFIG.defaultViewId,
  favorites: DEFAULT_CONFIG.favorites,
};

/**
 * Saved views, the default view and favorites, which live in the Studio config. Every change
 * reads the config again and writes it whole through `PUT /api/config`, so settings made
 * elsewhere in the meantime are kept.
 */
export function useViewsConfig() {
  const gateway = useRoutesGateway();
  const toast = useToast();
  const [config, setConfig] = useState<ViewsConfig>(INITIAL);

  useEffect(() => {
    let current = true;
    void gateway.getConfig().then((result) => {
      if (current && result.ok) setConfig(pick(result.value.config));
    });
    return () => {
      current = false;
    };
  }, [gateway]);

  const write = async (change: (config: StudioConfig) => StudioConfig): Promise<boolean> => {
    const loaded = await gateway.getConfig();
    const result = loaded.ok
      ? await gateway.updateConfig(change(loaded.value.config))
      : (loaded as typeof loaded);
    if (result.ok) {
      setConfig(pick(result.value.config));
      return true;
    }
    toast({ title: "Could not save", description: apiErrorMessage(result.error), tone: "error" });
    return false;
  };

  const updateView = (id: string, change: (view: View) => View) =>
    write((config) => ({
      ...config,
      views: config.views.map((view) => (view.id === id ? change(view) : view)),
    }));

  return {
    ...config,
    /** Adds a view and returns its id, or null when saving failed. */
    addView: async (view: Omit<View, "id">): Promise<string | null> => {
      let id = "";
      const saved = await write((config) => {
        id = uniqueId(
          slug(view.name),
          config.views.map((item) => item.id),
        );
        return { ...config, views: [...config.views, { ...view, id }] };
      });
      return saved ? id : null;
    },
    /** Replaces a saved view's grouping, sort and filters, keeping its id and name. */
    replaceView: (id: string, view: View) =>
      updateView(id, (current) => ({ ...view, id: current.id, name: current.name })),
    renameView: (id: string, name: string) => updateView(id, (view) => ({ ...view, name })),
    deleteView: (id: string) =>
      write((config) => {
        const views = config.views.filter((view) => view.id !== id);
        if (views.length === 0) return config;
        const defaultViewId = views.some((view) => view.id === config.defaultViewId)
          ? config.defaultViewId
          : (views[0]?.id ?? config.defaultViewId);
        return { ...config, views, defaultViewId };
      }),
    setDefaultView: (id: string) => write((config) => ({ ...config, defaultViewId: id })),
    /** Pins a route by name, or unpins it whether it was pinned by name or by port. */
    toggleFavorite: (route: Pick<Route, "name" | "port">) =>
      write((config) => {
        const pinned = config.favorites.filter((key) => keyMatchesRoute(key, route));
        return {
          ...config,
          favorites:
            pinned.length > 0
              ? config.favorites.filter((key) => !pinned.includes(key))
              : [...config.favorites, routeKey(route)],
        };
      }),
    /** Puts `key` in the custom group `groupId` of a view, or in none with `null`. */
    moveToGroup: (viewId: string, key: string, groupId: string | null) =>
      updateView(viewId, (view) => ({
        ...view,
        customGroups: (view.customGroups ?? []).map((group) => ({
          ...group,
          members:
            group.id === groupId
              ? [...group.members.filter((item) => item !== key), key]
              : group.members.filter((item) => item !== key),
        })),
      })),
    /** Creates a custom group in a view with `key` as its first member. */
    createGroup: (viewId: string, name: string, key: string) =>
      updateView(viewId, (view) => {
        const groups = (view.customGroups ?? []).map((group) => ({
          ...group,
          members: group.members.filter((item) => item !== key),
        }));
        const id = uniqueId(
          slug(name),
          groups.map((group) => group.id),
        );
        const created: CustomGroup = { id, name, members: [key] };
        return { ...view, customGroups: [...groups, created] };
      }),
    renameGroup: (viewId: string, groupId: string, name: string) =>
      updateView(viewId, (view) => ({
        ...view,
        customGroups: (view.customGroups ?? []).map((group) =>
          group.id === groupId ? { ...group, name } : group,
        ),
      })),
    deleteGroup: (viewId: string, groupId: string) =>
      updateView(viewId, (view) => ({
        ...view,
        customGroups: (view.customGroups ?? []).filter((group) => group.id !== groupId),
      })),
  };
}

export type ViewsConfigState = ReturnType<typeof useViewsConfig>;

function pick(config: StudioConfig): ViewsConfig {
  return {
    views: config.views,
    defaultViewId: config.defaultViewId,
    favorites: config.favorites,
  };
}

function slug(name: string): string {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "view";
}

function uniqueId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let index = 2;
  while (taken.includes(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}
