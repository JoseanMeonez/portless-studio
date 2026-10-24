import type { FitAddon } from "@xterm/addon-fit";
import type { ITerminalOptions, Terminal } from "@xterm/xterm";

/** What the terminal view needs from xterm.js. */
export type TerminalEngine = {
  createTerminal(options: ITerminalOptions): Terminal;
  createFit(): FitAddon;
};

let loading: Promise<TerminalEngine> | null = null;

/**
 * Loads xterm.js and its fit addon the first time a terminal opens. The dynamic imports put them
 * in their own chunk, so the dashboard's first load does not grow.
 */
export function loadTerminalEngine(): Promise<TerminalEngine> {
  loading ??= Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]).then(([xterm, fit]) => ({
    createTerminal: (options) => new xterm.Terminal(options),
    createFit: () => new fit.FitAddon(),
  }));
  return loading;
}
