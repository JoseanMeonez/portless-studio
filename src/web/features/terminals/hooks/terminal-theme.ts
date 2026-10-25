import type { ITheme } from "@xterm/xterm";
import type { TerminalAppearance } from "../../../../core/config/studio-config.ts";

const ANSI = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

type Capitalized = `bright${Capitalize<(typeof ANSI)[number]>}`;

/**
 * xterm.js colors from the design tokens (`--term-*` in styles/tokens.css): the `studio` theme
 * follows the page's light or dark mode, `dark` and `light` read their fixed sets.
 */
export function terminalTheme(
  theme: TerminalAppearance["theme"],
  read: (name: string) => string = cssVar,
): ITheme {
  const prefix = theme === "studio" ? "--term-" : `--term-${theme}-`;
  const colors: Record<string, string> = {};
  // A token the page does not define is left out, so xterm.js keeps its own color.
  const set = (key: string, name: string) => {
    const value = read(`${prefix}${name}`);
    if (value) colors[key] = value;
  };
  set("background", "background");
  set("foreground", "foreground");
  set("cursor", "cursor");
  set("cursorAccent", "background");
  set("selectionBackground", "selection");
  for (const name of ANSI) {
    set(name, name);
    const bright: Capitalized = `bright${capitalize(name)}`;
    set(bright, `bright-${name}`);
  }
  return colors as ITheme;
}

function capitalize<T extends string>(word: T): Capitalize<T> {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}` as Capitalize<T>;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
