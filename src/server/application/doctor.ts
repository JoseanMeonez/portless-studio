import type { PortlessInstallation, ProxyAction } from "../../core/api/contract.ts";
import type { StudioConfig } from "../../core/config/studio-config.ts";
import type { DoctorAction, DoctorCheck } from "../../core/doctor/doctor-check.ts";
import {
  adminWords,
  killCommand,
  portNeedsRoot,
  startLoginServiceCommand,
  stopProxyAsAdminCommand,
  trustCertificateCommand,
} from "../../core/doctor/platform-commands.ts";
import { err, ok, type Result } from "../../core/result.ts";
import type { ProxyStatus } from "../../core/routes/route.ts";
import { type AppError, appError } from "./app-error.ts";
import type { ProcessOwner } from "./process-control.ts";
import type { ShortUrlStatus } from "./short-urls.ts";
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
 * Whether browsers trust the portless certificate. Linux Chrome reads its own NSS store in
 * `~/.pki/nssdb`; macOS reads the keychain and Windows the user's Root store.
 */
export type BrowserTrust = "trusted" | "not-trusted" | "no-certutil" | "no-store" | "unknown";

/** What listens on the port Studio is configured to use. */
export type PortHolder =
  | { kind: "free" }
  | { kind: "studio" }
  | { kind: "other"; pid: number | null; processName: string };

/**
 * Whether portless's `routes.json` reads: `torn` is a file portless is still writing, `unexpected`
 * valid JSON in a format Studio does not know. `unreadable` counts entries Studio cannot use.
 */
export type RoutesFileFacts = {
  state: "ok" | "missing" | "torn" | "unexpected";
  entries: number;
  unreadable: number;
};

/** Whether `docker ps` answered: how many containers it listed, no `docker`, or no answer. */
export type DockerFacts =
  | { state: "ok"; containers: number }
  | { state: "missing" }
  | { state: "unavailable" };

/**
 * Whether this user can listen on 127.0.0.1:80 without sudo, tested with a bind that is closed at
 * once: `free`, `denied` by the system, or `in-use` by another program.
 */
export type LowPortFacts = "free" | "denied" | "in-use";

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
  /**
   * Whether OS notifications can be shown; absent when not checked. `limited` is macOS without
   * terminal-notifier: osascript shows them, but a click does nothing.
   */
  systemNotifier?: "available" | "limited" | "missing" | "unsupported";
  /** Absent when not checked. */
  routesFile?: RoutesFileFacts;
  /** Absent when not checked. */
  docker?: DockerFacts;
  /** Whether this user may listen on port 80, for short URLs; absent when not checked. */
  port80?: LowPortFacts;
  /** Studio's port-80 forwarder (`shortUrls`); absent when not known. */
  shortUrls?: ShortUrlStatus;
};

/** The checks, in the order people should read them. Pure, so every rule is easy to test. */
export function diagnose(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [portlessCheck(facts), configCheck(facts)];
  if (facts.portless.installed) {
    checks.push(proxyRunningCheck(facts));
    pushIf(checks, proxyOwnerCheck(facts));
    pushIf(checks, proxyCountCheck(facts));
    pushIf(checks, httpsTrustCheck(facts));
    pushIf(checks, routesFileCheck(facts));
    pushIf(checks, shorterUrlsCheck(facts));
  }
  checks.push(studioPortCheck(facts));
  pushIf(checks, loginServiceCheck(facts));
  pushIf(checks, safariCheck(facts));
  pushIf(checks, notificationsCheck(facts));
  pushIf(checks, dockerCheck(facts));
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
  /** Brings the short-URL forwarder in line with this config and says whether it listens. */
  syncShortUrls: (config: StudioConfig) => Promise<ShortUrlStatus>;
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
  if (action === "use-short-urls") return turnOnShortUrls(facts, deps);
  const http = { ...facts.config, proxyPort: 1355, proxyHttps: false };
  return applyProxyConfig(http, "HTTP on port 1355", facts, deps);
}

/**
 * Turns `shortUrls` on and checks that Studio really listens on port 80. The proxy keeps its
 * port and keeps running; when the listen fails, the previous config comes back.
 */
async function turnOnShortUrls(
  facts: DoctorFacts,
  deps: DoctorFixDeps,
): Promise<Result<string, AppError>> {
  const config = { ...facts.config, shortUrls: true };
  const saved = await deps.updateConfig(config);
  if (!saved.ok) return saved;
  const status = await deps.syncShortUrls(config);
  if (status.state === "listening") {
    return ok(
      "Names now open as http://name.localhost: Studio forwards port " +
        `${status.port} to the proxy on port ${status.target}.`,
    );
  }
  await deps.updateConfig(facts.config);
  await deps.syncShortUrls(facts.config);
  const why = status.state === "failed" ? `${status.message} ` : "";
  const code =
    status.state === "failed" && status.reason === "in-use" ? "port_in_use" : "command_failed";
  return err(
    appError(
      code,
      `${why}Studio kept the previous settings, so names still open with ` +
        `:${facts.config.proxyPort}.`,
    ),
  );
}

/**
 * Saves the proxy settings, then starts or restarts the proxy with them when Studio may. When
 * that start fails, the previous settings come back and a proxy that was running starts again on
 * them, so names keep working.
 */
async function applyProxyConfig(
  config: StudioConfig,
  what: string,
  facts: DoctorFacts,
  deps: DoctorFixDeps,
): Promise<Result<string, AppError>> {
  const saved = await deps.updateConfig(config);
  if (!saved.ok) return saved;
  if (facts.proxy.running && facts.proxyOwner !== "you") {
    return ok(
      `Saved ${what}. Stop the current proxy with \`${stopProxyAsAdminCommand(facts.platform)}\` ` +
        `${adminWords(facts.platform)}, then start the new one from the proxy menu.`,
    );
  }
  const started = await deps.controlProxy(facts.proxy.running ? "restart" : "start");
  if (started.ok) return started;
  await deps.updateConfig(facts.config);
  let back = "Studio went back to the previous settings.";
  if (facts.proxy.running) {
    const again = await deps.controlProxy("start");
    if (again.ok) {
      back =
        "Studio went back to the previous settings and started the proxy on port " +
        `${facts.config.proxyPort} again.`;
    }
  }
  return err({ ...started.error, message: `${started.error.message} ${back}` });
}

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
  const needsSudo = portNeedsRoot(platform, config.proxyPort);
  return {
    id: "proxy-running",
    status: "warn",
    title: "The proxy is not running",
    detail: needsSudo
      ? `Names do not open until it runs. portless asks for sudo below port 1024, so Studio ` +
        `cannot start it on port ${config.proxyPort}; HTTP on port 1355 needs nothing, and short ` +
        "URLs drop the port from names."
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

function proxyOwnerCheck({
  proxy,
  proxyPid,
  proxyOwner,
  platform,
}: DoctorFacts): DoctorCheck | null {
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
  const windows = platform === "win32";
  const who = proxyOwner === "root" ? "root" : windows ? "an Administrator" : "another user";
  const pid = proxyPid === null ? "" : `pid ${proxyPid}, `;
  return {
    id: "proxy-owner",
    status: "warn",
    title: `The proxy runs as ${who}`,
    detail:
      `It was started ${adminWords(platform)} (${pid}port ${proxy.port ?? "unknown"}), so Studio ` +
      "cannot stop or restart it. Stop it once the same way; Studio then starts its own proxy " +
      "over HTTP on port 1355.",
    fix: {
      label: windows ? "Stop it once as Administrator" : "Stop it once with sudo",
      command: stopProxyAsAdminCommand(platform),
    },
  };
}

/** portless is before 1.0 and may change its state files; Studio says so instead of hiding routes. */
function routesFileCheck({ routesFile, portless }: DoctorFacts): DoctorCheck | null {
  if (!routesFile) return null;
  const version = portless.version ? `portless ${portless.version}` : "This portless";
  const advice = "Update portless-studio, or report it with the portless version.";
  if (routesFile.state === "unexpected") {
    return {
      id: "routes-file",
      status: "warn",
      title: "Studio cannot read routes.json",
      detail:
        `${version} saved it in a format this version of Studio does not know, so no route is ` +
        `shown. ${advice}`,
    };
  }
  if (routesFile.state !== "ok" || routesFile.unreadable === 0) return null;
  return {
    id: "routes-file",
    status: "warn",
    title: `Studio cannot read ${routesFile.unreadable} of the ${routesFile.entries} routes portless saved`,
    detail:
      `${version} may have changed the format of routes.json, so those routes are not shown. ` +
      advice,
  };
}

function proxyCountCheck({ proxyProcesses, platform }: DoctorFacts): DoctorCheck | null {
  if (proxyProcesses === null || proxyProcesses.length < 2) return null;
  const listed = proxyProcesses
    .map((item) => `:${item.port ?? "?"} (${item.owner}, pid ${item.pid})`)
    .join(", ");
  const needsSudo = proxyProcesses.some((item) => item.owner === "root" || item.owner === "other");
  const pids = proxyProcesses.map((item) => item.pid);
  return {
    id: "proxy-count",
    status: "fail",
    title: `${proxyProcesses.length} portless proxies are running`,
    detail:
      `Found ${listed}. portless records only one of them, so names can open on one port and ` +
      "fail on the other. Stop them all, then start one from the proxy menu.",
    fix: { label: "Stop every proxy", command: killCommand(platform, pids, needsSudo) },
  };
}

function httpsTrustCheck(facts: DoctorFacts): DoctorCheck | null {
  const https = facts.proxy.running ? facts.proxy.https : facts.config.proxyHttps;
  if (!https || facts.browserTrust === "unknown") return null;
  const linux = facts.platform === "linux";
  if (facts.browserTrust === "trusted") {
    return {
      id: "https-trust",
      status: "ok",
      title: linux
        ? "Chrome trusts the portless certificate"
        : "This system trusts the portless certificate",
      detail: "HTTPS names open without a warning.",
    };
  }
  const ca = facts.caFile ?? "~/.portless/ca.pem";
  const trust = `\`${trustCertificateCommand(facts.platform, ca)}\``;
  const fix = { label: "Switch to HTTP on port 1355", action: "use-http-1355" as const };
  if (!linux) {
    const store = facts.platform === "darwin" ? "the macOS keychain" : "your Windows Root store";
    return {
      id: "https-trust",
      status: "warn",
      title: "Browsers may not trust the HTTPS certificate",
      detail:
        `The portless certificate is not in ${store}, so names show a certificate warning. ` +
        `Switch to HTTP, or trust the certificate with ${trust}.`,
      fix,
    };
  }
  const reason = {
    "not-trusted": "The portless certificate is not in Chrome's certificate store.",
    "no-store": "Chrome's certificate store (~/.pki/nssdb) does not exist yet.",
    "no-certutil": "certutil is not installed, so Studio cannot check Chrome's certificate store.",
  }[facts.browserTrust];
  return {
    id: "https-trust",
    status: "warn",
    title: "Chrome may not trust the HTTPS certificate",
    detail:
      `${reason} On Linux, Chrome reads ~/.pki/nssdb and not the system store, so names show ` +
      `ERR_CERT_AUTHORITY_INVALID. Switch to HTTP, or trust the certificate with ${trust} ` +
      "(package libnss3-tools).",
    fix,
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
  const command = startLoginServiceCommand(platform);
  return {
    id: "login-service",
    status: "warn",
    title: "The login service is installed but not running",
    detail: "Studio will start at the next login; start it now with the command.",
    fix: { label: "Start the service", command },
  };
}

function safariCheck({ platform, studioPort }: DoctorFacts): DoctorCheck | null {
  if (platform !== "darwin") return null;
  return {
    id: "safari",
    status: "ok",
    title: "Safari and .localhost names",
    detail:
      "Safari does not always send *.localhost names to this machine. If a name does not open " +
      `in Safari, open Studio at http://127.0.0.1:${studioPort.port} and each app at ` +
      "http://127.0.0.1:<its port>, or use Chrome or Firefox.",
  };
}

/** Information only: missing tools cost OS notifications or their click, nothing else. */
function notificationsCheck({ config, systemNotifier }: DoctorFacts): DoctorCheck | null {
  if (!config.systemNotifications) return null;
  if (systemNotifier === "limited") {
    return {
      id: "notifications",
      status: "ok",
      title: "macOS notifications come from Script Editor",
      detail:
        "Without terminal-notifier, Studio shows them through osascript: allow Script Editor in " +
        "System Settings > Notifications, and a click does not open Studio. With " +
        "terminal-notifier installed, a click opens the item.",
      fix: { label: "Install terminal-notifier", command: "brew install terminal-notifier" },
    };
  }
  if (systemNotifier !== "missing") return null;
  return {
    id: "notifications",
    status: "ok",
    title: "System notifications need notify-send",
    detail:
      "Studio skips them on this machine. Notifications in an open Studio tab still work. " +
      "The package is libnotify-bin on Debian and Ubuntu, libnotify elsewhere.",
    fix: { label: "Install notify-send", command: "sudo apt install libnotify-bin" },
  };
}

const UNPRIVILEGED_PORT_SETTING = "net.ipv4.ip_unprivileged_port_start=80";

/**
 * Short URLs drop the port number from every name (`http://name.localhost`). Studio itself listens
 * on port 80 and forwards to the proxy, only when a test bind shows this user may listen there
 * without sudo; it never changes the system.
 */
function shorterUrlsCheck(facts: DoctorFacts): DoctorCheck | null {
  const { proxy, config, platform, port80, shortUrls } = facts;
  const https = proxy.running ? proxy.https : config.proxyHttps;
  if (https) {
    if (!config.shortUrls) return null;
    return {
      id: "shorter-urls",
      status: "ok",
      title: "Short URLs work over HTTP only",
      detail:
        "The proxy serves HTTPS, so names keep their port. Switch the proxy to HTTP to open " +
        "them as http://name.localhost.",
    };
  }
  const port = (proxy.running ? proxy.port : null) ?? config.proxyPort;
  if (port === 80) {
    return {
      id: "shorter-urls",
      status: "ok",
      title: "Names open without a port number",
      detail: "The proxy uses port 80, so names open as http://name.localhost.",
    };
  }
  if (shortUrls?.state === "listening") {
    return {
      id: "shorter-urls",
      status: "ok",
      title: "Names open without a port number",
      detail:
        `Studio listens on port ${shortUrls.port} and forwards to the proxy on port ` +
        `${shortUrls.target}, so names open as http://name.localhost.`,
    };
  }
  const now = `Names open as http://name.localhost:${port}`;
  if (config.shortUrls) return failedShortUrlsCheck(facts, now);
  if (port80 === undefined) return null;
  if (port80 === "free") {
    return {
      id: "shorter-urls",
      status: "ok",
      title: "Shorter URLs: port 80 is available",
      detail:
        `${now}. This user can listen on port 80 without sudo, so Studio can listen there and ` +
        `forward to the proxy, and names open as http://name.localhost. The proxy stays on ` +
        `port ${port}.`,
      fix: { label: "Use short URLs", action: "use-short-urls" },
    };
  }
  if (port80 === "in-use") {
    return {
      id: "shorter-urls",
      status: "ok",
      title: "Port 80 is taken by another program",
      detail: `${now}. Stop the program on port 80 to drop the port number from names.`,
    };
  }
  if (platform !== "linux") {
    return {
      id: "shorter-urls",
      status: "ok",
      title: "Shorter URLs: this system does not allow port 80",
      detail: `${now}. This user cannot listen on port 80 here, so names keep the port.`,
    };
  }
  return {
    id: "shorter-urls",
    status: "ok",
    title: "Shorter URLs need a one-time system setting",
    detail: `${now}. ${SYSCTL_ADVICE} Then run the checks again and choose Use short URLs.`,
    fix: SYSCTL_FIX,
  };
}

/** `shortUrls` is on and Studio does not listen: names still work, with the port. */
function failedShortUrlsCheck(facts: DoctorFacts, now: string): DoctorCheck {
  const { platform, port80, shortUrls } = facts;
  const reason = shortUrls?.state === "failed" ? shortUrls.reason : port80;
  const retry =
    port80 === "free"
      ? { fix: { label: "Try port 80 again", action: "use-short-urls" as const } }
      : {};
  if (reason === "in-use") {
    return {
      id: "shorter-urls",
      status: "warn",
      title: "Short URLs are on, but port 80 is taken by another program",
      detail: `${now}. Stop the program on port 80, then run the checks again.`,
      ...retry,
    };
  }
  if (reason === "denied" && platform === "linux" && port80 !== "free") {
    return {
      id: "shorter-urls",
      status: "warn",
      title: "Short URLs are on, but Linux does not let this user listen on port 80",
      detail: `${now}. ${SYSCTL_ADVICE} Then run the checks again and choose Try port 80 again.`,
      fix: SYSCTL_FIX,
    };
  }
  return {
    id: "shorter-urls",
    status: "warn",
    title: "Short URLs are on, but Studio does not listen on port 80",
    detail:
      shortUrls?.state === "failed"
        ? `${now}. Studio could not listen there: ${shortUrls.message}`
        : `${now}. Studio is not running, or has not tried port 80 yet.`,
    ...retry,
  };
}

const SYSCTL_ADVICE =
  "Linux lets only root listen on ports below 1024. The command lets every user on this machine " +
  "listen on port 80 and up until the next restart; Studio never runs it. To keep it after a " +
  `restart, also run \`echo '${UNPRIVILEGED_PORT_SETTING}' | sudo tee ` +
  "/etc/sysctl.d/99-portless-studio.conf`.";

const SYSCTL_FIX = {
  label: "Allow port 80 until the next restart",
  command: `sudo sysctl -w ${UNPRIVILEGED_PORT_SETTING}`,
};

/** Information only: without Docker, container ports simply do not show. */
function dockerCheck({ docker }: DoctorFacts): DoctorCheck | null {
  if (docker === undefined || docker.state === "missing") return null;
  if (docker.state === "ok") {
    const count =
      docker.containers === 1 ? "1 running container" : `${docker.containers} running containers`;
    return {
      id: "docker",
      status: "ok",
      title: "Studio reads Docker containers",
      detail: `docker ps lists ${count}; the ports they publish show under Detected.`,
    };
  }
  return {
    id: "docker",
    status: "ok",
    title: "Studio cannot read Docker containers",
    detail:
      "The docker command is installed, but docker ps did not answer: Docker is not running, " +
      "or this user may not use it (on Linux, the docker group). Ports of containers do not " +
      "show under Detected until it answers.",
  };
}

function startCommand(config: StudioConfig): string {
  const tls = config.proxyHttps ? "--https" : "--no-tls";
  return `portless proxy start --port ${config.proxyPort} ${tls}`;
}

function pushIf(checks: DoctorCheck[], check: DoctorCheck | null): void {
  if (check) checks.push(check);
}
