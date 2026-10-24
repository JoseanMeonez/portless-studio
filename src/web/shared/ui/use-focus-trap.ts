import { type RefObject, useEffect, useState } from "react";

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Keeps Tab inside `container` while it is mounted, calls `onEscape` on Esc, and gives focus back
 * to whatever had it before the overlay opened.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>, onEscape: () => void) {
  // Read during the first render: by the time effects run, autoFocus has already moved focus inside.
  const [previous] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const element = container.current;
    return () => {
      // Leave focus alone when the overlay's own action already moved it somewhere else.
      const active = document.activeElement;
      const focusStillInside = !active || active === document.body || element?.contains(active);
      if (focusStillInside && previous?.isConnected) previous.focus();
    };
  }, [container, previous]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    element.addEventListener("keydown", handleKeyDown);
    return () => element.removeEventListener("keydown", handleKeyDown);
  }, [container, onEscape]);
}
