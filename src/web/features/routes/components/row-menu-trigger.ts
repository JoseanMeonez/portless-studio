import type { MouseEvent } from "react";

/** Where a row menu opens, in viewport pixels. */
export type MenuPoint = { x: number; y: number };

/**
 * Props that open the row menu on right-click, and on Ctrl+click or Cmd+click anywhere in the
 * row except its buttons, like desktop file lists.
 */
export function rowMenuTrigger(onMenu: (point: MenuPoint) => void) {
  return {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault();
      onMenu({ x: event.clientX, y: event.clientY });
    },
    onClick: (event: MouseEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if ((event.target as Element).closest("button")) return;
      // Also keeps the browser from opening the name link in a new tab.
      event.preventDefault();
      onMenu({ x: event.clientX, y: event.clientY });
    },
  };
}
