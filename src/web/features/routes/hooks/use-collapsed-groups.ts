import { useCallback, useMemo, useState } from "react";

const STORAGE_KEY = "portless-studio:collapsed-groups";

/**
 * Which group headers are closed, per view, remembered in this browser only. Storage can be
 * missing or blocked (private windows), so every access is guarded and the default is "open".
 */
export function useCollapsedGroups(viewId: string) {
  const [collapsed, setCollapsed] = useState<Record<string, string[]>>(readStored);
  const keys = collapsed[viewId];

  const update = useCallback(
    (change: (current: string[]) => string[]) => {
      setCollapsed((previous) => {
        const next = { ...previous, [viewId]: change(previous[viewId] ?? []) };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Not remembered, but still applied for this visit.
        }
        return next;
      });
    },
    [viewId],
  );

  const toggle = useCallback(
    (groupKey: string) =>
      update((current) =>
        current.includes(groupKey)
          ? current.filter((key) => key !== groupKey)
          : [...current, groupKey],
      ),
    [update],
  );

  /** Closes every group whose key is given; the list comes from the groups on screen. */
  const collapseAll = useCallback(
    (groupKeys: readonly string[]) => update(() => [...groupKeys]),
    [update],
  );
  const expandAll = useCallback(() => update(() => []), [update]);

  // Stable between renders, so lists built from it are not rebuilt on every keystroke.
  return useMemo(
    () => ({
      isCollapsed: (groupKey: string) => (keys ?? []).includes(groupKey),
      toggle,
      collapseAll,
      expandAll,
    }),
    [keys, toggle, collapseAll, expandAll],
  );
}

function readStored(): Record<string, string[]> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const result: Record<string, string[]> = {};
    for (const [view, keys] of Object.entries(value)) {
      if (Array.isArray(keys)) result[view] = keys.filter((key) => typeof key === "string");
    }
    return result;
  } catch {
    return {};
  }
}
