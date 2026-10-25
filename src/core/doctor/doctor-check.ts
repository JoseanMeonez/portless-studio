/** `ok` needs nothing, `warn` works but needs attention, `fail` keeps names from working. */
export type DoctorStatus = "ok" | "warn" | "fail";

/**
 * Fixes Studio can run by itself, without sudo: start the proxy with the config's port, restart a
 * proxy the current user owns, move the config to plain HTTP on port 1355, or move the proxy to
 * port 80 once this user may listen there, and apply it.
 */
export type DoctorAction = "start-proxy" | "restart-proxy" | "use-http-1355" | "use-port-80";

export type DoctorFix = {
  /** What the button says, or what the command does. */
  label: string;
  /** A command to copy and run in a terminal, for fixes that need sudo or another tool. */
  command?: string;
  /** A fix the server can run itself; the UI shows it as a button. */
  action?: DoctorAction;
};

/** One thing `portless-studio doctor` and the Health panel check. */
export type DoctorCheck = {
  /** Stable name, e.g. `proxy-owner`; `POST /api/doctor/fix/:id` runs this check's action. */
  id: string;
  status: DoctorStatus;
  title: string;
  /** What was found and why it matters, in a sentence or two. */
  detail: string;
  fix?: DoctorFix;
};

/** The worst status in the list: what the header dot and the CLI exit code show. */
export function overallStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}
