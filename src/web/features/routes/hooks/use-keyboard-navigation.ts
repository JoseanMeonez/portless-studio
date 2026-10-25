import { useEffect, useRef, useState } from "react";
import {
  hasAnyModifier,
  hasModifier,
  isActivatableTarget,
  isEditableTarget,
} from "../../../shared/lib/keyboard.ts";
import { findShortcut, type ShortcutId } from "./shortcut-registry.ts";

/** Fields marked with this attribute still pass arrows and Enter to the list, like the filter. */
export const LIST_KEYS_ATTRIBUTE = "data-list-keys";

type KeyboardNavigationOptions = {
  itemCount: number;
  /** Off while a dialog or menu is open, so its own keys win. */
  enabled: boolean;
  onOpen: (index: number) => void;
  onCopy: (index: number) => void;
  onRename: (index: number) => void;
  onRemove: (index: number) => void;
  onFavorite: (index: number) => void;
  /** Opens the row menu of the selected row (open with, copy path…). */
  onRowMenu: (index: number) => void;
  /** Opens a terminal in the selected row's project folder. */
  onTerminal: (index: number) => void;
  onCreate: () => void;
  onFocusFilter: () => void;
  onToggleCommandMenu: () => void;
  onOpenSettings: () => void;
  onNextView: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  onOpenViewMenu: () => void;
  onOpenFilters: () => void;
  onShowShortcuts: () => void;
  onEscape: () => void;
};

/**
 * Page-wide shortcuts for the routes list, dispatched from `SHORTCUTS` (see shortcut-registry.ts)
 * so the `?` cheat sheet always lists what the keys really do.
 */
export function useKeyboardNavigation(options: KeyboardNavigationOptions) {
  const [selected, setSelected] = useState(0);
  const selectedIndex = options.itemCount === 0 ? -1 : Math.min(selected, options.itemCount - 1);

  // Read the latest callbacks without re-binding the listener on every render.
  const latest = useRef({ ...options, selectedIndex });
  latest.current = { ...options, selectedIndex };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      if (hasModifier(event)) {
        if (findShortcut(event.key, true)?.id === "command-menu") {
          event.preventDefault();
          current.onToggleCommandMenu();
        }
        return;
      }
      if (!current.enabled || hasAnyModifier(event) || event.defaultPrevented) return;

      const shortcut = findShortcut(event.key, false);
      if (!shortcut) return;
      if (event.key === "F10" && !event.shiftKey) return;
      const target = event.target;
      const inListField = target instanceof HTMLElement && target.hasAttribute(LIST_KEYS_ATTRIBUTE);
      const typing = isEditableTarget(target);
      // Letters type into fields; only arrows and Enter pass through the filter to the list.
      const isArrowOrEnter = ["ArrowDown", "ArrowUp", "Enter"].includes(event.key);
      if (typing && !(inListField && shortcut.inFilter && isArrowOrEnter)) return;
      if (event.key === "Enter" && !inListField && isActivatableTarget(target)) return;

      const index = current.selectedIndex;
      if (shortcut.needsSelection && index === -1) return;
      if (shortcut.id === "close") {
        current.onEscape();
        return;
      }
      event.preventDefault();
      const move = (to: number) => {
        if (current.itemCount === 0) return;
        setSelected(Math.max(0, Math.min(to, current.itemCount - 1)));
      };
      const actions: Record<Exclude<ShortcutId, "close" | "command-menu">, () => void> = {
        "move-down": () => move(index + 1),
        "move-up": () => move(index - 1),
        first: () => move(0),
        last: () => move(current.itemCount),
        "focus-filter": current.onFocusFilter,
        open: () => current.onOpen(index),
        copy: () => current.onCopy(index),
        rename: () => current.onRename(index),
        remove: () => current.onRemove(index),
        favorite: () => current.onFavorite(index),
        "row-menu": () => current.onRowMenu(index),
        "open-terminal": () => current.onTerminal(index),
        "name-port": current.onCreate,
        "next-view": current.onNextView,
        "collapse-all": current.onCollapseAll,
        "expand-all": current.onExpandAll,
        "view-menu": current.onOpenViewMenu,
        "filter-menu": current.onOpenFilters,
        settings: current.onOpenSettings,
        help: current.onShowShortcuts,
      };
      if (shortcut.id !== "command-menu") actions[shortcut.id]();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { selectedIndex, select: setSelected };
}
