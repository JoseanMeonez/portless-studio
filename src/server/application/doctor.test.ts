import { DEFAULT_CONFIG } from "../../core/config/studio-config.ts";
import type { DoctorCheck } from "../../core/doctor/doctor-check.ts";
import { overallStatus } from "../../core/doctor/doctor-check.ts";
import { err, ok } from "../../core/result.ts";
import { type DoctorFacts, type DoctorFixDeps, diagnose, runDoctorFix } from "./doctor.ts";

/** A healthy machine: user-owned HTTP proxy on 1355, Studio on its port, service running. */
function facts(change: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    platform: "linux",
    portless: { installed: true, version: "0.15.11" },
    proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
    proxyPid: 4100,
    proxyOwner: "you",
    proxyProcesses: [{ pid: 4100, port: 1355, https: false, owner: "you" }],
    config: DEFAULT_CONFIG,
    configError: null,
    configPath: "/home/dev/.config/portless-studio/config.json",
    caFile: "/home/dev/.portless/ca.pem",
    browserTrust: "unknown",
    studioPort: { port: 4949, holder: { kind: "studio" } },
    loginService: { installed: true, running: true },
    ...change,
  };
}

const byId = (checks: DoctorCheck[], id: string) => checks.find((check) => check.id === id);

describe("diagnose system notifications", () => {
  it("says, as information, that notify-send is missing when system notifications are on", () => {
    const on = { ...DEFAULT_CONFIG, systemNotifications: true };
    const check = byId(diagnose(facts({ config: on, systemNotifier: "missing" })), "notifications");
    expect(check).toMatchObject({ status: "ok", title: "System notifications need notify-send" });
    expect(check?.fix?.command).toBe("sudo apt install libnotify-bin");
  });

  it("says nothing when they work or are off", () => {
    const on = { ...DEFAULT_CONFIG, systemNotifications: true };
    expect(
      byId(diagnose(facts({ config: on, systemNotifier: "available" })), "notifications"),
    ).toBe(undefined);
    expect(byId(diagnose(facts({ systemNotifier: "missing" })), "notifications")).toBe(undefined);
  });
});

describe("diagnose", () => {
  it("reports nothing to fix on a healthy machine", () => {
    const checks = diagnose(facts());
    expect(overallStatus(checks)).toBe("ok");
    expect(checks.map((check) => check.id)).toEqual([
      "portless",
      "config",
      "proxy-running",
      "proxy-owner",
      "studio-port",
      "login-service",
    ]);
  });

  it("warns about a proxy started as root and gives the sudo command", () => {
    const checks = diagnose(
      facts({
        proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
        proxyPid: 3694271,
        proxyOwner: "root",
        proxyProcesses: [{ pid: 3694271, port: 443, https: true, owner: "root" }],
      }),
    );
    const owner = byId(checks, "proxy-owner");
    expect(owner).toMatchObject({ status: "warn", title: "The proxy runs as root" });
    expect(owner?.detail).toContain("3694271");
    expect(owner?.fix).toEqual({
      label: "Stop it once with sudo",
      command: "sudo portless proxy stop",
    });
  });

  it("fails when two proxies run and lists both with their owners", () => {
    const checks = diagnose(
      facts({
        proxyProcesses: [
          { pid: 3694271, port: 443, https: true, owner: "root" },
          { pid: 3701892, port: 1355, https: false, owner: "you" },
        ],
      }),
    );
    const multiple = byId(checks, "proxy-count");
    expect(multiple?.status).toBe("fail");
    expect(multiple?.detail).toContain(":443 (root, pid 3694271)");
    expect(multiple?.detail).toContain(":1355 (you, pid 3701892)");
    expect(multiple?.fix?.command).toBe("sudo kill 3694271 3701892");
    expect(overallStatus(checks)).toBe("fail");
  });

  it("uses kill without sudo when every extra proxy is the user's own", () => {
    const checks = diagnose(
      facts({
        proxyProcesses: [
          { pid: 10, port: 1355, https: false, owner: "you" },
          { pid: 11, port: 1356, https: false, owner: "you" },
        ],
      }),
    );
    expect(byId(checks, "proxy-count")?.fix?.command).toBe("kill 10 11");
  });

  it("warns when the proxy serves HTTPS that Chrome does not trust, and offers HTTP", () => {
    const checks = diagnose(
      facts({
        proxy: { running: true, port: 1355, https: true, tlds: ["localhost"] },
        browserTrust: "not-trusted",
      }),
    );
    const trust = byId(checks, "https-trust");
    expect(trust?.status).toBe("warn");
    expect(trust?.detail).toContain("ERR_CERT_AUTHORITY_INVALID");
    expect(trust?.detail).toContain("certutil -d sql:$HOME/.pki/nssdb");
    expect(trust?.fix).toMatchObject({ action: "use-http-1355" });
  });

  it("explains that certutil is missing instead of claiming the certificate is trusted", () => {
    const checks = diagnose(
      facts({
        proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
        browserTrust: "no-certutil",
      }),
    );
    expect(byId(checks, "https-trust")?.detail).toContain("certutil is not installed");
  });

  it("skips the trust check on plain HTTP and when it cannot be known", () => {
    expect(byId(diagnose(facts()), "https-trust")).toBeUndefined();
    const mac = facts({
      platform: "darwin",
      proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
      browserTrust: "unknown",
    });
    expect(byId(diagnose(mac), "https-trust")).toBeUndefined();
  });

  it("fails when portless is missing and skips the proxy checks", () => {
    const checks = diagnose(
      facts({ portless: { installed: false, version: null }, proxyProcesses: [] }),
    );
    expect(byId(checks, "portless")).toMatchObject({
      status: "fail",
      fix: { command: "npm install -g portless" },
    });
    expect(byId(checks, "proxy-running")).toBeUndefined();
  });

  it("offers to start a stopped proxy on a port that needs no sudo", () => {
    const checks = diagnose(
      facts({
        proxy: { running: false, port: null, https: false, tlds: ["localhost"] },
        proxyPid: null,
        proxyOwner: "unknown",
        proxyProcesses: [],
      }),
    );
    expect(byId(checks, "proxy-running")).toMatchObject({
      status: "warn",
      fix: { action: "start-proxy", command: "portless proxy start --port 1355 --no-tls" },
    });
    expect(byId(checks, "proxy-owner")).toBeUndefined();
  });

  it("offers HTTP on 1355 instead of starting a stopped proxy on 443", () => {
    const checks = diagnose(
      facts({
        proxy: { running: false, port: 443, https: true, tlds: ["localhost"] },
        proxyOwner: "unknown",
        proxyProcesses: [],
        config: { ...DEFAULT_CONFIG, proxyPort: 443, proxyHttps: true },
      }),
    );
    expect(byId(checks, "proxy-running")?.fix?.action).toBe("use-http-1355");
  });

  it("fails when another program holds Studio's port", () => {
    const checks = diagnose(
      facts({
        studioPort: { port: 4949, holder: { kind: "other", pid: 77, processName: "java" } },
      }),
    );
    expect(byId(checks, "studio-port")).toMatchObject({
      status: "fail",
      fix: { command: "portless-studio --port 4950" },
    });
    expect(byId(checks, "studio-port")?.title).toContain("java");
  });

  it("names a broken config file and keeps running", () => {
    const checks = diagnose(
      facts({ configError: '"port" must be a whole number from 1 to 65535.' }),
    );
    expect(byId(checks, "config")).toMatchObject({
      status: "fail",
      fix: { command: "portless-studio config --edit" },
    });
  });

  it("warns when the login service is installed but not running", () => {
    const checks = diagnose(facts({ loginService: { installed: true, running: false } }));
    expect(byId(checks, "login-service")).toMatchObject({
      status: "warn",
      fix: { command: "systemctl --user start portless-studio" },
    });
  });

  it("adds the Safari note on macOS only", () => {
    expect(byId(diagnose(facts({ platform: "darwin" })), "safari")?.status).toBe("ok");
    expect(byId(diagnose(facts()), "safari")).toBeUndefined();
  });
});

describe("runDoctorFix", () => {
  const stoppedProxy = facts({
    proxy: { running: false, port: null, https: false, tlds: ["localhost"] },
    proxyPid: null,
    proxyOwner: "unknown",
    proxyProcesses: [],
  });

  function deps(current: DoctorFacts) {
    const calls: string[] = [];
    const fixDeps: DoctorFixDeps = {
      collect: async () => current,
      controlProxy: async (action: "start" | "stop" | "restart") => {
        calls.push(`proxy ${action}`);
        return ok(`proxy ${action}ed`);
      },
      updateConfig: async (config: typeof DEFAULT_CONFIG) => {
        calls.push(`config ${config.proxyPort} ${config.proxyHttps}`);
        return ok(undefined);
      },
    };
    return { calls, deps: fixDeps };
  }

  it("runs the action of the check with that id and returns the checks again", async () => {
    const { calls, deps: d } = deps(stoppedProxy);
    const result = await runDoctorFix("proxy-running", d);
    expect(calls).toEqual(["proxy start"]);
    expect(result.ok && result.value.checks.length).toBeGreaterThan(0);
  });

  it("refuses a check that has no action, such as one that needs sudo", async () => {
    const root = facts({ proxyOwner: "root" });
    const { calls, deps: d } = deps(root);
    const result = await runDoctorFix("proxy-owner", d);
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(calls).toEqual([]);
  });

  it("switches to HTTP on 1355 and restarts a proxy the user owns", async () => {
    const https = facts({
      proxy: { running: true, port: 1355, https: true, tlds: ["localhost"] },
      browserTrust: "not-trusted",
    });
    const { calls, deps: d } = deps(https);
    await runDoctorFix("https-trust", d);
    expect(calls).toEqual(["config 1355 false", "proxy restart"]);
  });

  it("only saves the config when the proxy belongs to root", async () => {
    const root = facts({
      proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
      proxyOwner: "root",
      browserTrust: "not-trusted",
    });
    const { calls, deps: d } = deps(root);
    const result = await runDoctorFix("https-trust", d);
    expect(calls).toEqual(["config 1355 false"]);
    expect(result.ok && result.value.message).toContain("sudo portless proxy stop");
  });

  it("passes on a failure from the proxy", async () => {
    const { deps: d } = deps(stoppedProxy);
    d.controlProxy = async () => err({ code: "command_failed", message: "port in use" });
    const result = await runDoctorFix("proxy-running", d);
    expect(result).toMatchObject({ ok: false, error: { message: "port in use" } });
  });
});

describe("diagnose on macOS and Windows", () => {
  const https = { running: true, port: 1355, https: true, tlds: ["localhost"] };
  const stopped = { running: false, port: null, https: false, tlds: ["localhost"] };

  it("starts a stopped macOS login service with bootstrap, which works after a bootout", () => {
    const checks = diagnose(
      facts({ platform: "darwin", loginService: { installed: true, running: false } }),
    );
    expect(byId(checks, "login-service")?.fix?.command).toBe(
      "launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.portless-studio.plist",
    );
  });

  it("never shows sudo on Windows: Administrator terminals and taskkill instead", () => {
    const checks = diagnose(
      facts({
        platform: "win32",
        proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
        proxyOwner: "other",
        proxyProcesses: null,
        browserTrust: "not-trusted",
      }),
    );
    const owner = byId(checks, "proxy-owner");
    expect(owner?.fix).toEqual({
      label: "Stop it once as Administrator",
      command: "portless proxy stop",
    });
    expect(owner?.detail).toContain("Administrator");
    expect(JSON.stringify(checks)).not.toContain("sudo");
  });

  it("starts a stopped proxy on port 443 on macOS, which needs no root there", () => {
    const checks = diagnose(
      facts({
        platform: "darwin",
        proxy: stopped,
        proxyPid: null,
        proxyOwner: "unknown",
        proxyProcesses: [],
        config: { ...DEFAULT_CONFIG, proxyPort: 443, proxyHttps: true },
      }),
    );
    expect(byId(checks, "proxy-running")?.fix).toMatchObject({
      action: "start-proxy",
      command: "portless proxy start --port 443 --https",
    });
  });

  it("gives the trust command of each system's own certificate store", () => {
    const mac = byId(
      diagnose(facts({ platform: "darwin", proxy: https, browserTrust: "not-trusted" })),
      "https-trust",
    );
    expect(mac?.detail).toContain("security add-trusted-cert");
    expect(mac?.detail).not.toContain("nssdb");
    const windows = byId(
      diagnose(facts({ platform: "win32", proxy: https, browserTrust: "not-trusted" })),
      "https-trust",
    );
    expect(windows?.detail).toContain("certutil -user -addstore Root");
    const trusted = byId(
      diagnose(facts({ platform: "win32", proxy: https, browserTrust: "trusted" })),
      "https-trust",
    );
    expect(trusted).toMatchObject({
      status: "ok",
      title: "This system trusts the portless certificate",
    });
  });

  it("points Safari to the 127.0.0.1 address of Studio and of each app", () => {
    const safari = byId(diagnose(facts({ platform: "darwin" })), "safari");
    expect(safari?.detail).toContain("http://127.0.0.1:4949");
  });

  it("explains macOS notifications without terminal-notifier", () => {
    const on = { ...DEFAULT_CONFIG, systemNotifications: true };
    const check = byId(
      diagnose(facts({ platform: "darwin", config: on, systemNotifier: "limited" })),
      "notifications",
    );
    expect(check?.status).toBe("ok");
    expect(check?.detail).toContain("Script Editor");
    expect(check?.fix?.command).toBe("brew install terminal-notifier");
  });
});

describe("runDoctorFix on Windows", () => {
  it("asks for an Administrator terminal instead of sudo after saving HTTP", async () => {
    const current = facts({
      platform: "win32",
      proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
      proxyOwner: "other",
      browserTrust: "not-trusted",
    });
    const result = await runDoctorFix("https-trust", {
      collect: async () => current,
      controlProxy: async () => ok("done"),
      updateConfig: async () => ok(undefined),
    });
    expect(result.ok && result.value.message).toContain("Administrator");
    expect(result.ok && result.value.message).not.toContain("sudo");
  });
});
