/** Keys the terminal area keeps for itself, even while the terminal screen has focus. */
export type PanelKey = "rename" | "next" | "previous" | "close" | "toggle-list" | "full-screen";

type KeyPress = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">;

/**
 * Which panel action a key press asks for, or null to let it through to the terminal. Escape is
 * not here: programs in the terminal need it, so it leaves full screen only from the list or
 * the header.
 */
export function panelKey(event: KeyPress): PanelKey | null {
  const key = event.key.toLowerCase();
  if (event.altKey) return null;
  if (event.key === "F2" && !event.ctrlKey && !event.metaKey && !event.shiftKey) return "rename";
  if (event.ctrlKey && !event.shiftKey && event.key === "PageDown") return "next";
  if (event.ctrlKey && !event.shiftKey && event.key === "PageUp") return "previous";
  if (event.ctrlKey && event.shiftKey && key === "w") return "close";
  if (event.ctrlKey && event.shiftKey && key === "f") return "full-screen";
  // Ctrl+B, or Cmd+B on macOS.
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === "b") return "toggle-list";
  return null;
}
