import { useEffect, useRef, useState } from "react";
import {
  hasAnyModifier,
  hasModifier,
  isActivatableTarget,
  isEditableTarget,
} from "../../../shared/lib/keyboard.ts";

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
  onCreate: () => void;
  onFocusFilter: () => void;
  onToggleCommandMenu: () => void;
  onOpenSettings: () => void;
  onEscape: () => void;
};

/**
 * Page-wide shortcuts for the routes list: j/k or arrows move, Enter or o opens, c copies,
 * r renames, Delete removes, n names a port, / filters, comma opens settings, Cmd/Ctrl+K opens
 * the command menu.
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
      if (hasModifier(event) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        current.onToggleCommandMenu();
        return;
      }
      if (!current.enabled || hasAnyModifier(event) || event.defaultPrevented) return;

      const target = event.target;
      const inListField = target instanceof HTMLElement && target.hasAttribute(LIST_KEYS_ATTRIBUTE);
      const typing = isEditableTarget(target);
      const index = current.selectedIndex;
      const move = (delta: number) => {
        event.preventDefault();
        if (current.itemCount === 0) return;
        setSelected(Math.max(0, Math.min(index + delta, current.itemCount - 1)));
      };

      if (typing && !inListField) return;
      if (event.key === "ArrowDown") return move(1);
      if (event.key === "ArrowUp") return move(-1);
      if (event.key === "Enter") {
        if (index === -1 || (!inListField && isActivatableTarget(target))) return;
        event.preventDefault();
        current.onOpen(index);
        return;
      }
      if (typing) return;

      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const onSelected = (action: (index: number) => void) => {
        if (index !== -1) run(() => action(index));
      };

      switch (event.key) {
        case "j":
          return move(1);
        case "k":
          return move(-1);
        case "Home":
          return move(-index);
        case "End":
          return move(current.itemCount);
        case "o":
          return onSelected(current.onOpen);
        case "c":
          return onSelected(current.onCopy);
        case "r":
          return onSelected(current.onRename);
        case "Delete":
        case "Backspace":
          return onSelected(current.onRemove);
        case "n":
          return run(current.onCreate);
        case "/":
          return run(current.onFocusFilter);
        case ",":
          return run(current.onOpenSettings);
        case "Escape":
          return current.onEscape();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { selectedIndex, select: setSelected };
}
