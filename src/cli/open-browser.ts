import { spawn } from "node:child_process";

/** Opens `url` in the default browser without waiting for it; failures are ignored. */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? // The empty argument is the window title `start` expects before the target.
          ["cmd.exe", ["/d", "/c", "start", '""', url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // Keeps `""` literal for cmd.exe; the URL is ours and has no characters cmd.exe interprets.
      windowsVerbatimArguments: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser launcher on this machine; the URL is printed anyway.
  }
}
