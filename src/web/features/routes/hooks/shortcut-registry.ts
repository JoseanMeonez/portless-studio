/**
 * Every keyboard shortcut of the dashboard, in one place. The keyboard hook dispatches from it,
 * the command menu shows its keys and the `?` cheat sheet lists it, so the three never disagree.
 */

export type ShortcutGroup = "Navigation" | "Actions" | "Views" | "Terminal" | "App";

export type ShortcutId =
  | "move-down"
  | "move-up"
  | "first"
  | "last"
  | "focus-filter"
  | "open"
  | "copy"
  | "rename"
  | "remove"
  | "favorite"
  | "row-menu"
  | "open-terminal"
  | "new-terminal"
  | "name-port"
  | "next-view"
  | "collapse-all"
  | "expand-all"
  | "view-menu"
  | "filter-menu"
  | "command-menu"
  | "settings"
  | "help"
  | "close"
  | TerminalShortcutId;

/** Keys the terminal panel handles itself; the page's keyboard handler never sees them. */
export type TerminalShortcutId =
  | "rename-terminal"
  | "next-terminal"
  | "close-terminal"
  | "toggle-terminal-list"
  | "terminal-full-screen"
  | "leave-full-screen";

export type Shortcut = {
  id: ShortcutId;
  group: ShortcutGroup;
  label: string;
  /** `KeyboardEvent.key` values that trigger it. */
  keys: readonly string[];
  /** What to show, one list of key caps per alternative. `mod` is Cmd on macOS, Ctrl elsewhere. */
  combos: readonly (readonly string[])[];
  /** Needs Cmd or Ctrl held; works even while typing. */
  modifier?: boolean;
  /** Also works while the filter field has focus, like arrows and Enter. */
  inFilter?: boolean;
  /** Acts on the selected row, so it does nothing when no row is selected. */
  needsSelection?: boolean;
  /**
   * Works only while the terminal area has focus; the terminal panel handles it, so the page's
   * keyboard handler skips it.
   */
  inTerminal?: boolean;
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  "Navigation",
  "Actions",
  "Views",
  "Terminal",
  "App",
];

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: "move-down",
    group: "Navigation",
    label: "Next row",
    keys: ["j", "ArrowDown"],
    combos: [["J"], ["↓"]],
    inFilter: true,
  },
  {
    id: "move-up",
    group: "Navigation",
    label: "Previous row",
    keys: ["k", "ArrowUp"],
    combos: [["K"], ["↑"]],
    inFilter: true,
  },
  { id: "first", group: "Navigation", label: "First row", keys: ["Home"], combos: [["Home"]] },
  { id: "last", group: "Navigation", label: "Last row", keys: ["End"], combos: [["End"]] },
  {
    id: "focus-filter",
    group: "Navigation",
    label: "Search routes",
    keys: ["/"],
    combos: [["/"]],
  },
  {
    id: "open",
    group: "Actions",
    label: "Open the selected route",
    keys: ["Enter", "o"],
    combos: [["Enter"], ["O"]],
    inFilter: true,
    needsSelection: true,
  },
  {
    id: "copy",
    group: "Actions",
    label: "Copy its URL",
    keys: ["c"],
    combos: [["C"]],
    needsSelection: true,
  },
  {
    id: "rename",
    group: "Actions",
    label: "Rename an alias",
    keys: ["r"],
    combos: [["R"]],
    needsSelection: true,
  },
  {
    id: "remove",
    group: "Actions",
    label: "Remove an alias",
    keys: ["Delete", "Backspace"],
    combos: [["Delete"]],
    needsSelection: true,
  },
  {
    id: "favorite",
    group: "Actions",
    label: "Pin or unpin as favorite",
    keys: ["f"],
    combos: [["F"]],
    needsSelection: true,
  },
  {
    id: "row-menu",
    group: "Actions",
    label: "Open with, copy path and more",
    // F10 counts only with Shift; the keyboard hook checks it.
    keys: [".", "ContextMenu", "F10"],
    combos: [["."], ["Shift", "F10"]],
    needsSelection: true,
  },
  {
    id: "open-terminal",
    group: "Actions",
    label: "Open a terminal in its folder",
    keys: ["t"],
    combos: [["T"]],
    needsSelection: true,
  },
  {
    id: "new-terminal",
    group: "Actions",
    label: "New terminal in any folder",
    // Ctrl on every system: Cmd+` switches windows on macOS. The keyboard hook checks it.
    keys: ["`"],
    combos: [["Ctrl", "`"]],
    modifier: true,
  },
  { id: "name-port", group: "Actions", label: "Name a port", keys: ["n"], combos: [["N"]] },
  { id: "next-view", group: "Views", label: "Next view", keys: ["v"], combos: [["V"]] },
  {
    id: "collapse-all",
    group: "Views",
    label: "Collapse all groups",
    keys: ["["],
    combos: [["["]],
  },
  { id: "expand-all", group: "Views", label: "Expand all groups", keys: ["]"], combos: [["]"]] },
  {
    id: "view-menu",
    group: "Views",
    label: "Open the view menu",
    keys: ["V"],
    combos: [["Shift", "V"]],
  },
  {
    id: "filter-menu",
    group: "Views",
    label: "Open the filters",
    keys: ["F"],
    combos: [["Shift", "F"]],
  },
  {
    id: "toggle-terminal-list",
    group: "Terminal",
    label: "Toggle terminal list",
    keys: ["b"],
    combos: [["mod", "B"]],
    modifier: true,
    inTerminal: true,
  },
  {
    id: "terminal-full-screen",
    group: "Terminal",
    label: "Full screen terminal",
    keys: ["F"],
    combos: [["Ctrl", "Shift", "F"]],
    modifier: true,
    inTerminal: true,
  },
  {
    id: "leave-full-screen",
    group: "Terminal",
    label: "Leave full screen (from the list or header)",
    keys: ["Escape"],
    combos: [["Esc"]],
    inTerminal: true,
  },
  {
    id: "rename-terminal",
    group: "Terminal",
    label: "Rename the active terminal",
    keys: ["F2"],
    combos: [["F2"]],
    inTerminal: true,
  },
  {
    id: "next-terminal",
    group: "Terminal",
    label: "Next or previous terminal",
    keys: ["PageDown", "PageUp"],
    combos: [
      ["Ctrl", "PgDn"],
      ["Ctrl", "PgUp"],
    ],
    modifier: true,
    inTerminal: true,
  },
  {
    id: "close-terminal",
    group: "Terminal",
    label: "Close the active terminal",
    keys: ["W"],
    combos: [["Ctrl", "Shift", "W"]],
    modifier: true,
    inTerminal: true,
  },
  {
    id: "command-menu",
    group: "App",
    label: "Command menu",
    keys: ["k"],
    combos: [["mod", "K"]],
    modifier: true,
  },
  { id: "settings", group: "App", label: "Settings", keys: [","], combos: [[","]] },
  { id: "help", group: "App", label: "Keyboard shortcuts", keys: ["?"], combos: [["?"]] },
  {
    id: "close",
    group: "App",
    label: "Close a dialog or cancel",
    keys: ["Escape"],
    combos: [["Esc"]],
  },
];

/** The shortcut a key press triggers, if any. */
export function findShortcut(key: string, withModifier: boolean): Shortcut | undefined {
  const page = SHORTCUTS.filter((item) => !item.inTerminal);
  if (withModifier) {
    return page.find((item) => item.modifier && item.keys.includes(key.toLowerCase()));
  }
  return page.find((item) => !item.modifier && item.keys.includes(key));
}

export function shortcutById(id: ShortcutId): Shortcut {
  const shortcut = SHORTCUTS.find((item) => item.id === id);
  if (!shortcut) throw new Error(`unknown shortcut ${id}`);
  return shortcut;
}

/** Key caps of the first combo, with `mod` spelled for this platform. */
export function shortcutKeys(id: ShortcutId, modifierLabel: string): string[] {
  const [combo = []] = shortcutById(id).combos;
  return combo.map((key) => (key === "mod" ? modifierLabel : key));
}
