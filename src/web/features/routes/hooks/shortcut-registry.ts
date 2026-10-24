/**
 * Every keyboard shortcut of the dashboard, in one place. The keyboard hook dispatches from it,
 * the command menu shows its keys and the `?` cheat sheet lists it, so the three never disagree.
 */

export type ShortcutGroup = "Navigation" | "Actions" | "Views" | "App";

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
  | "name-port"
  | "next-view"
  | "view-menu"
  | "command-menu"
  | "settings"
  | "help"
  | "close";

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
};

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["Navigation", "Actions", "Views", "App"];

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
  { id: "name-port", group: "Actions", label: "Name a port", keys: ["n"], combos: [["N"]] },
  { id: "next-view", group: "Views", label: "Next view", keys: ["v"], combos: [["V"]] },
  {
    id: "view-menu",
    group: "Views",
    label: "Open the view menu",
    keys: ["V"],
    combos: [["Shift", "V"]],
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
  if (withModifier) {
    return SHORTCUTS.find((item) => item.modifier && item.keys.includes(key.toLowerCase()));
  }
  return SHORTCUTS.find((item) => !item.modifier && item.keys.includes(key));
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
