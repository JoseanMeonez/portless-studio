/**
 * Commands Studio shows people to copy, written for their system. Windows has no sudo: a command
 * that needs more rights runs in a terminal opened with Run as Administrator.
 */

/** A Node `process.platform` value; core stays free of Node types. */
export type Platform = string;

const LAUNCHD_LABEL = "dev.portless-studio";

/** Where the login service's LaunchAgent lives on macOS, written so a shell expands it. */
export const LAUNCH_AGENT_PATH = `~/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;

/** How the person starts the login service again, also after it was stopped (booted out). */
export function startLoginServiceCommand(platform: Platform): string {
  if (platform === "darwin") return `launchctl bootstrap gui/$(id -u) ${LAUNCH_AGENT_PATH}`;
  if (platform === "win32") return "portless-studio";
  return "systemctl --user start portless-studio";
}

/** Stops a proxy another user (root, or an Administrator) started. */
export function stopProxyAsAdminCommand(platform: Platform): string {
  return platform === "win32" ? "portless proxy stop" : "sudo portless proxy stop";
}

/** Stops processes; `admin` when some belong to another user. */
export function killCommand(platform: Platform, pids: readonly number[], admin: boolean): string {
  if (platform === "win32") return `taskkill /F ${pids.map((pid) => `/PID ${pid}`).join(" ")}`;
  return `${admin ? "sudo " : ""}kill ${pids.join(" ")}`;
}

/** "with sudo" or "from an Administrator terminal", for sentences that explain a command. */
export function adminWords(platform: Platform): string {
  return platform === "win32" ? "from a terminal opened with Run as Administrator" : "with sudo";
}

/**
 * Whether portless asks for sudo to start its proxy on this port. It does on Linux and macOS for
 * every port below 1024, even where the system would let this user bind it; Windows never asks.
 */
export function portNeedsRoot(platform: Platform, port: number): boolean {
  return port < 1024 && platform !== "win32";
}

/** Trusts the portless certificate authority in the store this system's browsers read. */
export function trustCertificateCommand(platform: Platform, caFile: string): string {
  if (platform === "darwin") {
    return `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caFile}"`;
  }
  if (platform === "win32") return `certutil -user -addstore Root "${caFile}"`;
  return `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n portless -i ${caFile}`;
}
