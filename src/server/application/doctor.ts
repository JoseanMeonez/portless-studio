import type { PortlessInstallation, ProxyAction } from "../../core/api/contract.ts";
import type { StudioConfig } from "../../core/config/studio-config.ts";
import type { DoctorAction, DoctorCheck } from "../../core/doctor/doctor-check.ts";
import { err, ok, type Result } from "../../core/result.ts";
import type { ProxyStatus } from "../../core/routes/route.ts";
import { type AppError, appError } from "./app-error.ts";
import type { ProcessOwner } from "./process-control.ts";
import type { LoginServiceState } from "./studio-service.ts";

/** A `portless proxy start` process found in the process list. */
export type ProxyProcess = {
  pid: number;
  /** From `--port`; null when the command line does not say. */
  port: number | null;
  https: boolean;
  owner: ProcessOwner;
};

/**
 * Whether Chrome trusts the portless certificate. Linux Chrome reads its own NSS store in
 * `~/.pki/nssdb`, not the system store; other systems are `unknown` and not checked.
 */
export type BrowserTrust = "trusted" | "not-trusted" | "no-certutil" | "no-store" | "unknown";

/** What listens on the port Studio is configured to use. */
export type PortHolder =
  | { kind: "free" }
  | { kind: "studio" }
  | { kind: "other"; pid: number | null; processName: string };

/** Everything the checks look at, gathered from the machine by an infrastructure collector. */
export type DoctorFacts = {
  platform: NodeJS.Platform;
  portless: PortlessInstallation;
  /** The proxy portless recorded in its state files. */
  proxy: ProxyStatus;
  proxyPid: number | null;
  proxyOwner: ProcessOwner;
  /** Every portless proxy process; null when this system cannot list them (Windows). */
  proxyProcesses: ProxyProcess[] | null;
  /** The config in effect: the file, or the defaults when the file is broken. */
  config: StudioConfig;
  configError: string | null;
  configPath: string;
  /** The portless certificate authority, for the command that trusts it. */
  caFile: string | null;
  browserTrust: BrowserTrust;
  studioPort: { port: number; holder: PortHolder };
  /** Null when it cannot be known, e.g. when Studio runs from source. */
  loginService: LoginServiceState | null;
};

/** The checks, in the order people should read them. Pure, so every rule is easy to test. */
export function diagnose(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [portlessCheck(facts), configCheck(facts)];
  if (facts.portless.installed) {
    checks.push(proxyRunningCheck(facts));
    pushIf(checks, proxyOwnerCheck(facts));
    pushIf(checks, proxyCountCheck(facts));
    pushIf(checks, httpsTrustCheck(facts));
  }
  checks.push(studioPortCheck(facts));
  pushIf(checks, loginServiceCheck(facts));
  pushIf(checks, safariCheck(facts));
  return checks;
}

/** What the HTTP server and the CLI use: run the checks, or run one check's safe fix. */
export type DoctorService = {
  check(): Promise<DoctorCheck[]>;
  fix(id: string): Promise<Result<{ message: string; checks: DoctorCheck[] }, AppError>>;
};

export function createDoctorService(deps: DoctorFixDeps): DoctorService {
  return {
    check: async () => diagnose(await deps.collect()),
    fix: (id) => runDoctorFix(id, deps),
  };
}

export type DoctorFixDeps = {
  collect: () => Promise<DoctorFacts>;
  controlProxy: (action: ProxyAction) => Promise<Result<string, AppError>>;
  updateConfig: (config: StudioConfig) => Promise<Result<unknown, AppError>>;
};

/**
 * Runs the fix of the check with this id, but only when the checks offer it as an action right
 * now; commands that need sudo are never run.
 */
export async function runDoctorFix(
  id: string,
  deps: DoctorFixDeps,
): Promise<Result<{ message: string; checks: DoctorCheck[] }, AppError>> {
  const facts = await deps.collect();
  const action = diagnose(facts).find((check) => check.id === id)?.fix?.action;
  if (!action) return err(appError("not_found", `There is no fix Studio can run for "${id}".`));
  const done = await runAction(action, facts, deps);
  if (!done.ok) return done;
  return ok({ message: done.value, checks: diagnose(await deps.collect()) });
}

async function runAction(
  action: DoctorAction,
  facts: DoctorFacts,
  deps: DoctorFixDeps,
): Promise<Result<string, AppError>> {
  if (action === "start-proxy") return deps.controlProxy("start");
  if (action === "restart-proxy") return deps.controlProxy("restart");

  const saved = await deps.updateConfig({ ...facts.config, proxyPort: 1355, proxyHttps: false });
  if (!saved.ok) return saved;
  if (!facts.proxy.running) return deps.controlProxy("start");
  if (facts.proxyOwner === "you") return deps.controlProxy("restart");
  return ok(
    "Saved HTTP on port 1355. Stop the current proxy with `sudo portless proxy stop`, then start " +
      "the new one from the proxy menu.",
  );
}

const STOP_WITH_SUDO = "sudo portless proxy stop";

function portlessCheck({ portless }: DoctorFacts): DoctorCheck {
  if (portless.installed) {
    return {
      id: "portless",
      status: "ok",
      title: portless.version
        ? `portless ${portless.version} is installed`
        : "portless is installed",
      detail: "Studio names ports and starts the proxy through it.",
    };
  }
  return {
    id: "portless",
    status: "fail",
    title: "portless is not installed",
    detail: "Without it no port gets a name. Install it, then run the checks again.",
    fix: { label: "Install portless", command: "npm install -g portless" },
  };
}

function configCheck({ configError, configPath }: DoctorFacts): DoctorCheck {
  if (configError === null) {
    return {
      id: "config",
      status: "ok",
      title: "The config file is valid",
      detail: configPath,
    };
  }
  return {
    id: "config",
    status: "fail",
    title: "The config file has an error",
    detail: `${configPath}: ${configError} Studio keeps using the last settings that worked.`,
    fix: { label: "Open the config file", command: "portless-studio config --edit" },
  };
}

function proxyRunningCheck(facts: DoctorFacts): DoctorCheck {
  const { proxy, proxyPid, config, platform } = facts;
  if (proxy.running) {
    const where = proxy.port === null ? "" : ` on port ${proxy.port}`;
    const pid = proxyPid === null ? "" : ` (pid ${proxyPid})`;
    return {
      id: "proxy-running",
      status: "ok",
      title: "The proxy is running",
      detail: `It serves ${proxy.https ? "HTTPS" : "HTTP"}${where}${pid}.`,
    };
  }
  const needsSudo = config.proxyPort < 1024 && platform !== "win32";
  return {
    id: "proxy-running",
    status: "warn",
    title: "The proxy is not running",
    detail: needsSudo
      ? `Names do not open until it runs. Port ${config.proxyPort} needs sudo, so Studio cannot ` +
        "start it; HTTP on port 1355 needs nothing."
      : "Names do not open until it runs.",
    fix: needsSudo
      ? { label: "Use HTTP on port 1355", action: "use-http-1355" }
      : {
          label: `Start the proxy on port ${config.proxyPort}`,
          action: "start-proxy",
          command: startCommand(config),
        },
  };
}

function proxyOwnerCheck({ proxy, proxyPid, proxyOwner }: DoctorFacts): DoctorCheck | null {
  if (!proxy.running || proxyOwner === "unknown") return null;
  if (proxyOwner === "you") {
    return {
      id: "proxy-owner",
      status: "ok",
      title: "The proxy runs as you",
      detail: "Studio can stop and restart it.",
      fix: { label: "Restart the proxy", action: "restart-proxy" },
    };
  }
  const who = proxyOwner === "root" ? "root" : "another user";
  const pid = proxyPid === null ? "" : `pid ${proxyPid}, `;
  return {
    id: "proxy-owner",
    status: "warn",
    title: `The proxy runs as ${who}`,
    detail:
      `It was started with sudo (${pid}port ${proxy.port ?? "unknown"}), so Studio cannot stop ` +
      "or restart it. Stop it once; Studio then starts its own proxy over HTTP on port 1355.",
    fix: { label: "Stop it once with sudo", command: STOP_WITH_SUDO },
  };
}

function proxyCountCheck({ proxyProcesses }: DoctorFacts): DoctorCheck | null {
  if (proxyProcesses === null || proxyProcesses.length < 2) return null;
  const listed = proxyProcesses
    .map((item) => `:${item.port ?? "?"} (${item.owner}, pid ${item.pid})`)
    .join(", ");
  const needsSudo = proxyProcesses.some((item) => item.owner === "root" || item.owner === "other");
  const pids = proxyProcesses.map((item) => item.pid).join(" ");
  return {
    id: "proxy-count",
    status: "fail",
    title: `${proxyProcesses.length} portless proxies are running`,
    detail:
      `Found ${listed}. portless records only one of them, so names can open on one port and ` +
      "fail on the other. Stop them all, then start one from the proxy menu.",
    fix: { label: "Stop every proxy", command: `${needsSudo ? "sudo " : ""}kill ${pids}` },
  };
}

function httpsTrustCheck(facts: DoctorFacts): DoctorCheck | null {
  const https = facts.proxy.running ? facts.proxy.https : facts.config.proxyHttps;
  if (!https || facts.browserTrust === "unknown") return null;
  if (facts.browserTrust === "trusted") {
    return {
      id: "https-trust",
      status: "ok",
      title: "Chrome trusts the portless certificate",
      detail: "HTTPS names open without a warning.",
    };
  }
  const reason = {
    "not-trusted": "The portless certificate is not in Chrome's certificate store.",
    "no-store": "Chrome's certificate store (~/.pki/nssdb) does not exist yet.",
    "no-certutil": "certutil is not installed, so Studio cannot check Chrome's certificate store.",
  }[facts.browserTrust];
  const ca = facts.caFile ?? "~/.portless/ca.pem";
  return {
    id: "https-trust",
    status: "warn",
    title: "Chrome may not trust the HTTPS certificate",
    detail:
      `${reason} On Linux, Chrome reads ~/.pki/nssdb and not the system store, so names show ` +
      "ERR_CERT_AUTHORITY_INVALID. Switch to HTTP, or trust the certificate with " +
      `\`certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n portless -i ${ca}\` (package libnss3-tools).`,
    fix: { label: "Switch to HTTP on port 1355", action: "use-http-1355" },
  };
}

function studioPortCheck({ studioPort }: DoctorFacts): DoctorCheck {
  const { port, holder } = studioPort;
  if (holder.kind === "studio") {
    return {
      id: "studio-port",
      status: "ok",
      title: `Studio answers on port ${port}`,
      detail: "Its port belongs to Studio.",
    };
  }
  if (holder.kind === "free") {
    return {
      id: "studio-port",
      status: "ok",
      title: `Port ${port} is free`,
      detail: "Studio can start on it.",
    };
  }
  const pid = holder.pid === null ? "" : ` (pid ${holder.pid})`;
  const next = port === 65535 ? port - 1 : port + 1;
  return {
    id: "studio-port",
    status: "fail",
    title: `Port ${port} is taken by ${holder.processName || "another program"}${pid}`,
    detail: `Studio cannot listen on it. Start it on another port, or change "port" in the config.`,
    fix: { label: "Start Studio on another port", command: `portless-studio --port ${next}` },
  };
}

function loginServiceCheck({ loginService, platform }: DoctorFacts): DoctorCheck | null {
  if (loginService === null) return null;
  if (!loginService.installed) {
    return {
      id: "login-service",
      status: "ok",
      title: "Studio does not start at login",
      detail: "Optional: start it when you log in, so names and auto mode always work.",
      fix: { label: "Start Studio at login", command: "portless-studio service install" },
    };
  }
  if (loginService.running) {
    return {
      id: "login-service",
      status: "ok",
      title: "Studio starts at login",
      detail: "The login service is installed and running.",
    };
  }
  const command =
    platform === "darwin"
      ? "launchctl kickstart gui/$(id -u)/dev.portless-studio"
      : platform === "win32"
        ? "portless-studio"
        : "systemctl --user start portless-studio";
  return {
    id: "login-service",
    status: "warn",
    title: "The login service is installed but not running",
    detail: "Studio will start at the next login; start it now with the command.",
    fix: { label: "Start the service", command },
  };
}

function safariCheck({ platform }: DoctorFacts): DoctorCheck | null {
  if (platform !== "darwin") return null;
  return {
    id: "safari",
    status: "ok",
    title: "Safari and .localhost names",
    detail:
      "Safari does not always send *.localhost names to this machine. If a name does not open " +
      "in Safari, use Chrome or Firefox, or open the route's local port.",
  };
}

function startCommand(config: StudioConfig): string {
  const tls = config.proxyHttps ? "--https" : "--no-tls";
  return `portless proxy start --port ${config.proxyPort} ${tls}`;
}

function pushIf(checks: DoctorCheck[], check: DoctorCheck | null): void {
  if (check) checks.push(check);
}
