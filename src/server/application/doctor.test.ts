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

describe("diagnose routes.json", () => {
  it("warns, with the portless version, about entries Studio cannot read", () => {
    const check = byId(
      diagnose(facts({ routesFile: { state: "ok", entries: 5, unreadable: 2 } })),
      "routes-file",
    );
    expect(check).toEqual({
      id: "routes-file",
      status: "warn",
      title: "Studio cannot read 2 of the 5 routes portless saved",
      detail:
        "portless 0.15.11 may have changed the format of routes.json, so those routes are not " +
        "shown. Update portless-studio, or report it with the portless version.",
    });
  });

  it("warns when routes.json is in a format Studio does not know", () => {
    const check = byId(
      diagnose(facts({ routesFile: { state: "unexpected", entries: 0, unreadable: 0 } })),
      "routes-file",
    );
    expect(check).toMatchObject({
      status: "warn",
      title: "Studio cannot read routes.json",
      detail:
        "portless 0.15.11 saved it in a format this version of Studio does not know, so no " +
        "route is shown. Update portless-studio, or report it with the portless version.",
    });
  });

  it("says nothing while every entry reads", () => {
    const ok = facts({ routesFile: { state: "ok", entries: 3, unreadable: 0 } });
    expect(byId(diagnose(ok), "routes-file")).toBe(undefined);
    const missing = facts({ routesFile: { state: "missing", entries: 0, unreadable: 0 } });
    expect(byId(diagnose(missing), "routes-file")).toBe(undefined);
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
      syncShortUrls: async () => ({ state: "off" }),
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

  it("goes back to the previous ports and restarts the proxy on them when the restart fails", async () => {
    const https = facts({
      config: { ...DEFAULT_CONFIG, proxyPort: 1443, proxyHttps: true },
      proxy: { running: true, port: 1443, https: true, tlds: ["localhost"] },
      browserTrust: "not-trusted",
    });
    const { calls, deps: d } = deps(https);
    let attempts = 0;
    d.controlProxy = async (action) => {
      calls.push(`proxy ${action}`);
      attempts += 1;
      return attempts === 1
        ? err({ code: "port_in_use", message: "port 1355 is in use by another process." })
        : ok("started");
    };
    const result = await runDoctorFix("https-trust", d);
    expect(calls).toEqual([
      "config 1355 false",
      "proxy restart",
      "config 1443 true",
      "proxy start",
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "port_in_use",
        message:
          "port 1355 is in use by another process. Studio went back to the previous settings " +
          "and started the proxy on port 1443 again.",
      },
    });
  });

  it("goes back to the previous config when a stopped proxy does not start on the new port", async () => {
    const stoppedOn443 = facts({
      config: { ...DEFAULT_CONFIG, proxyPort: 443, proxyHttps: true },
      proxy: { running: false, port: null, https: true, tlds: ["localhost"] },
      proxyOwner: "unknown",
      proxyProcesses: [],
    });
    const { calls, deps: d } = deps(stoppedOn443);
    d.controlProxy = async (action) => {
      calls.push(`proxy ${action}`);
      return err({ code: "command_failed", message: "the proxy did not start." });
    };
    const result = await runDoctorFix("proxy-running", d);
    expect(calls).toEqual(["config 1355 false", "proxy start", "config 443 true"]);
    expect(result).toMatchObject({
      ok: false,
      error: { message: "the proxy did not start. Studio went back to the previous settings." },
    });
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

  it("offers HTTP on 1355 for a stopped proxy on 443 on macOS, where portless asks for sudo", () => {
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
    expect(byId(checks, "proxy-running")?.fix?.action).toBe("use-http-1355");
  });

  it("starts a stopped proxy on port 443 on Windows, where portless needs no Administrator", () => {
    const checks = diagnose(
      facts({
        platform: "win32",
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
      syncShortUrls: async () => ({ state: "off" }),
    });
    expect(result.ok && result.value.message).toContain("Administrator");
    expect(result.ok && result.value.message).not.toContain("sudo");
  });
});

describe("diagnose Docker", () => {
  it("says how many containers Studio reads", () => {
    const check = byId(diagnose(facts({ docker: { state: "ok", containers: 2 } })), "docker");
    expect(check).toMatchObject({ status: "ok", title: "Studio reads Docker containers" });
    expect(check?.detail).toContain("2 running containers");
  });

  it("says, as information, when Docker is installed but cannot be read", () => {
    const check = byId(diagnose(facts({ docker: { state: "unavailable" } })), "docker");
    expect(check).toMatchObject({
      status: "ok",
      title: "Studio cannot read Docker containers",
    });
  });

  it("says nothing without Docker", () => {
    expect(byId(diagnose(facts({ docker: { state: "missing" } })), "docker")).toBe(undefined);
    expect(byId(diagnose(facts()), "docker")).toBe(undefined);
  });
});

describe("diagnose shorter URLs", () => {
  const shortOn = { ...DEFAULT_CONFIG, shortUrls: true };

  it("offers short URLs when this user can listen on port 80, keeping the proxy on 1355", () => {
    const check = byId(diagnose(facts({ port80: "free" })), "shorter-urls");
    expect(check).toMatchObject({
      status: "ok",
      title: "Shorter URLs: port 80 is available",
      fix: { label: "Use short URLs", action: "use-short-urls" },
    });
    expect(check?.detail).toContain("http://name.localhost");
    expect(check?.detail).toContain("The proxy stays on port 1355");
  });

  it("gives Linux the one-time sysctl command and how to keep it, never running it", () => {
    const check = byId(diagnose(facts({ port80: "denied" })), "shorter-urls");
    expect(check?.fix).toEqual({
      label: "Allow port 80 until the next restart",
      command: "sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80",
    });
    expect(check?.detail).toContain(
      "echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/99-portless-studio.conf",
    );
  });

  it("offers no command on macOS or Windows when the bind is refused", () => {
    const check = byId(diagnose(facts({ platform: "darwin", port80: "denied" })), "shorter-urls");
    expect(check?.fix).toBe(undefined);
  });

  it("says port 80 is taken by another program", () => {
    const check = byId(diagnose(facts({ port80: "in-use" })), "shorter-urls");
    expect(check?.title).toBe("Port 80 is taken by another program");
    expect(check?.fix).toBe(undefined);
  });

  it("says names open without a port while Studio forwards port 80", () => {
    const check = byId(
      diagnose(
        facts({
          config: shortOn,
          port80: "in-use",
          shortUrls: { state: "listening", port: 80, target: 1355 },
        }),
      ),
      "shorter-urls",
    );
    expect(check).toMatchObject({ status: "ok", title: "Names open without a port number" });
    expect(check?.detail).toBe(
      "Studio listens on port 80 and forwards to the proxy on port 1355, so names open as " +
        "http://name.localhost.",
    );
  });

  it("warns when short URLs are on and port 80 is taken, and keeps the port in names", () => {
    const check = byId(
      diagnose(
        facts({
          config: shortOn,
          port80: "in-use",
          shortUrls: {
            state: "failed",
            port: 80,
            reason: "in-use",
            message: "port 80 is in use by another program.",
          },
        }),
      ),
      "shorter-urls",
    );
    expect(check).toMatchObject({
      status: "warn",
      title: "Short URLs are on, but port 80 is taken by another program",
    });
    expect(check?.detail).toContain("Names open as http://name.localhost:1355");
  });

  it("gives the sysctl command when short URLs are on and Linux refuses port 80", () => {
    const check = byId(
      diagnose(
        facts({
          config: shortOn,
          port80: "denied",
          shortUrls: { state: "failed", port: 80, reason: "denied", message: "refused." },
        }),
      ),
      "shorter-urls",
    );
    expect(check?.status).toBe("warn");
    expect(check?.fix?.command).toBe("sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80");
  });

  it("offers to try again once port 80 became free", () => {
    const check = byId(
      diagnose(
        facts({
          config: shortOn,
          port80: "free",
          shortUrls: { state: "failed", port: 80, reason: "denied", message: "refused." },
        }),
      ),
      "shorter-urls",
    );
    expect(check?.fix).toEqual({ label: "Try port 80 again", action: "use-short-urls" });
  });

  it("says short URLs need HTTP when they are on over HTTPS, and skips HTTPS otherwise", () => {
    const https = { running: true, port: 1355, https: true, tlds: ["localhost"] };
    const on = byId(diagnose(facts({ config: shortOn, proxy: https })), "shorter-urls");
    expect(on?.title).toBe("Short URLs work over HTTP only");
    expect(byId(diagnose(facts({ proxy: https, port80: "free" })), "shorter-urls")).toBe(undefined);
  });

  it("says the URLs are already short when the proxy itself runs on port 80", () => {
    const proxy = { running: true, port: 80, https: false, tlds: ["localhost"] };
    const check = byId(diagnose(facts({ proxy, port80: "in-use" })), "shorter-urls");
    expect(check?.title).toBe("Names open without a port number");
    expect(byId(diagnose(facts()), "shorter-urls")).toBe(undefined);
  });

  it("never offers to start the proxy on port 80 as a normal user on Linux or macOS", () => {
    const on80 = { ...DEFAULT_CONFIG, proxyPort: 80 };
    const proxy = { running: false, port: null, https: false, tlds: ["localhost"] };
    for (const platform of ["linux", "darwin"] as const) {
      const checks = diagnose(
        facts({ platform, config: on80, proxy, proxyOwner: "unknown", port80: "free" }),
      );
      expect(byId(checks, "proxy-running")?.fix?.action).toBe("use-http-1355");
    }
  });
});

describe("runDoctorFix use-short-urls", () => {
  function fixDeps(current: DoctorFacts, listens: boolean) {
    const calls: string[] = [];
    const deps: DoctorFixDeps = {
      collect: async () => current,
      controlProxy: async (action) => {
        calls.push(`proxy ${action}`);
        return ok(`proxy ${action}ed`);
      },
      updateConfig: async (config) => {
        calls.push(`config shortUrls=${config.shortUrls} proxyPort=${config.proxyPort}`);
        return ok(undefined);
      },
      syncShortUrls: async (config) => {
        calls.push(`sync ${config.shortUrls}`);
        if (!config.shortUrls) return { state: "off" };
        return listens
          ? { state: "listening", port: 80, target: config.proxyPort }
          : {
              state: "failed",
              port: 80,
              reason: "in-use",
              message: "port 80 is in use by another program.",
            };
      },
    };
    return { calls, deps };
  }

  it("turns short URLs on and checks Studio listens, leaving the proxy alone", async () => {
    const { calls, deps } = fixDeps(facts({ port80: "free" }), true);
    const result = await runDoctorFix("shorter-urls", deps);
    expect(result).toMatchObject({
      ok: true,
      value: {
        message:
          "Names now open as http://name.localhost: Studio forwards port 80 to the proxy on " +
          "port 1355.",
      },
    });
    expect(calls).toEqual(["config shortUrls=true proxyPort=1355", "sync true"]);
  });

  it("goes back to the previous config when Studio cannot listen", async () => {
    const { calls, deps } = fixDeps(facts({ port80: "free" }), false);
    const result = await runDoctorFix("shorter-urls", deps);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "port_in_use",
        message:
          "port 80 is in use by another program. Studio kept the previous settings, so names " +
          "still open with :1355.",
      },
    });
    expect(calls).toEqual([
      "config shortUrls=true proxyPort=1355",
      "sync true",
      "config shortUrls=false proxyPort=1355",
      "sync false",
    ]);
  });

  it("runs nothing when the system does not allow port 80", async () => {
    const { calls, deps } = fixDeps(facts({ port80: "denied" }), true);
    const result = await runDoctorFix("shorter-urls", deps);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
