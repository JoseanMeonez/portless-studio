/**
 * Signals that should stop Studio cleanly: Ctrl+C and service managers send SIGINT and SIGTERM,
 * a closed terminal sends SIGHUP, and on Windows Ctrl+Break sends SIGBREAK and closing the
 * console window arrives as SIGHUP. Windows never sends SIGTERM.
 */
export function shutdownSignals(platform: NodeJS.Platform): NodeJS.Signals[] {
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  return platform === "win32" ? [...signals, "SIGBREAK"] : signals;
}

/** Calls `stop` on the first shutdown signal. */
export function onShutdown(
  target: { on(signal: NodeJS.Signals, listener: () => void): unknown },
  platform: NodeJS.Platform,
  stop: () => void,
): void {
  for (const signal of shutdownSignals(platform)) target.on(signal, stop);
}
