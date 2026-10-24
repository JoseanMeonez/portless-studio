import { DEFAULT_CONFIG } from "../../../core/config/studio-config.ts";
import { err, ok } from "../../../core/result.ts";
import type { ConfigStore } from "../../application/config-store.ts";
import type { ProcessControl } from "../../application/process-control.ts";
import type { PortlessState, RouteRegistry } from "../../application/route-registry.ts";
import {
  collectDoctorFacts,
  type DoctorFactsOptions,
  listProxyProcesses,
  parseCertutilList,
  parsePortlessProxyArgs,
  parsePortlessProxyLine,
  parsePsProcesses,
  proxyPidsAmong,
} from "./doctor-facts.ts";
import type { SystemIo } from "./system-io.ts";

const NODE = "/home/dev/.nvm/versions/node/v24.22.0/bin/node";
const PORTLESS = "/home/dev/.nvm/versions/node/v24.22.0/bin/portless";
const ROOT_PROXY = [NODE, PORTLESS, "proxy", "start", "--foreground", "--port", "443", "--https"];
const USER_PROXY = [NODE, PORTLESS, "proxy", "start", "--foreground", "--port", "1355", "--no-tls"];
const status = (uid: number) => `Name:\tnode\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\n`;

/** /proc as a real machine showed it: a root proxy on 443 and a user-owned one on 1355. */
function linuxIo(run: SystemIo["run"] = async () => ({ exitCode: null, stdout: "" })): SystemIo {
  const files: Record<string, string> = {
    "/proc/3694271/cmdline": `${ROOT_PROXY.join("\0")}\0`,
    "/proc/3694271/status": status(0),
    "/proc/3701892/cmdline": `${USER_PROXY.join("\0")}\0`,
    "/proc/3701892/status": status(1000),
    "/proc/3706312/cmdline": `${[NODE, "/code/portless-studio/dist/cli/index.js"].join("\0")}\0`,
    "/proc/3706312/status": status(1000),
  };
  return {
    readFile: (path) => files[path] ?? null,
    readDir: (path) => (path === "/proc" ? ["1", "3694271", "3701892", "3706312", "self"] : []),
    readLink: () => null,
    run,
  };
}

describe("parsers", () => {
  it("reads port and protocol from a portless proxy command line", () => {
    expect(parsePortlessProxyArgs(ROOT_PROXY)).toEqual({ port: 443, https: true });
    expect(parsePortlessProxyArgs(USER_PROXY)).toEqual({ port: 1355, https: false });
    expect(parsePortlessProxyArgs(["portless", "proxy", "start", "--port=8443"])).toEqual({
      port: 8443,
      https: false,
    });
  });

  it("ignores other portless commands and other programs", () => {
    expect(parsePortlessProxyArgs([NODE, PORTLESS, "alias", "web", "3000"])).toBeNull();
    expect(parsePortlessProxyArgs([NODE, "/code/portless-studio/dist/cli/index.js"])).toBeNull();
    expect(parsePortlessProxyArgs(["vim", "portless", "proxy", "start"])).toBeNull();
  });

  it("reads ps -A -o pid=,uid=,args= output", () => {
    const text = `  501   501 /usr/local/bin/node /usr/local/bin/portless proxy start --port 1355 --no-tls
    1     0 /sbin/launchd
`;
    expect(parsePsProcesses(text)).toEqual(
      [
        {
          pid: 501,
          uid: 501,
          args: [
            "/usr/local/bin/node",
            "/usr/local/bin/portless",
            "proxy",
            "start",
            "--port",
            "1355",
            "--no-tls",
          ],
        },
        { pid: 1, uid: 0, args: ["/sbin/launchd"] },
      ].map((row) => expect.objectContaining(row)),
    );
    expect(parsePsProcesses(text)[1]?.line).toBe("/sbin/launchd");
  });

  it("reads a proxy from the raw ps line, so paths with spaces stay whole", () => {
    expect(
      parsePortlessProxyLine(
        "/Users/dev/My Tools/node/bin/node /Users/dev/My Tools/node/bin/portless proxy start --port 443 --https",
      ),
    ).toEqual({ port: 443, https: true });
    expect(parsePortlessProxyLine("/opt/homebrew/bin/portless proxy start")).toEqual({
      port: null,
      https: false,
    });
    expect(parsePortlessProxyLine("/bin/zsh -c portless proxy start")).toBeNull();
    expect(parsePortlessProxyLine("vim /tmp/x -c /usr/bin/portless proxy start")).toBeNull();
    expect(
      parsePortlessProxyLine("/usr/local/bin/node /usr/local/bin/portless alias web 3000"),
    ).toBeNull();
  });

  it("finds a portless entry in certutil -L output", () => {
    const listing = `
Certificate Nickname                                         Trust Attributes
                                                             SSL,S/MIME,JAR/XPI

portless Local CA                                            C,,
`;
    expect(parseCertutilList(listing)).toBe(true);
    expect(parseCertutilList(listing.replace("portless Local CA", "Some Bank CA"))).toBe(false);
  });
});

describe("listProxyProcesses", () => {
  it("finds both proxies with their owners on Linux", async () => {
    expect(await listProxyProcesses("linux", linuxIo(), 1000)).toEqual([
      { pid: 3694271, port: 443, https: true, owner: "root" },
      { pid: 3701892, port: 1355, https: false, owner: "you" },
    ]);
  });

  it("lists them on macOS from ps -ww, whose lines keep spaces in paths", async () => {
    const calls: string[] = [];
    const io = linuxIo(async (bin, args) => {
      calls.push([bin, ...args].join(" "));
      return {
        exitCode: 0,
        stdout:
          "  612   501 /Users/dev/Node Versions/bin/node /Users/dev/Node Versions/bin/portless proxy start --port 1355 --no-tls\n" +
          "    1     0 /sbin/launchd\n",
      };
    });
    expect(await listProxyProcesses("darwin", io, 501)).toEqual([
      { pid: 612, port: 1355, https: false, owner: "you" },
    ]);
    expect(calls).toEqual(["ps -ww -A -o pid=,uid=,args="]);
  });

  it("cannot list them on Windows", async () => {
    expect(await listProxyProcesses("win32", linuxIo(), null)).toBeNull();
  });
});

describe("collectDoctorFacts", () => {
  function options(change: Partial<DoctorFactsOptions> = {}): DoctorFactsOptions {
    const state: PortlessState = {
      proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
      portless: { installed: true, version: "0.15.11" },
      routes: [],
      readAt: 1,
    };
    const registry = {
      readSnapshot: async () => state,
      proxyPid: async () => 3694271,
    } as unknown as RouteRegistry;
    const configStore: ConfigStore = {
      path: "/home/dev/.config/portless-studio/config.json",
      read: async () => ok(DEFAULT_CONFIG),
      write: async () => ok(undefined),
      watch: () => () => {},
    };
    const processes: ProcessControl = {
      ownerOf: async (pid) => (pid === 3694271 ? "root" : "you"),
      terminate: async () => ok(undefined),
    };
    return {
      platform: "linux",
      homeDir: "/home/dev",
      stateDir: "/home/dev/.portless",
      uid: 1000,
      registry,
      configStore,
      processes,
      io: linuxIo(),
      listPorts: async () => [{ port: 4949, pid: 3706312, processName: "node", cwd: null }],
      probe: async () => ({ status: 200, latencyMs: 2, studio: true }),
      loginService: async () => ({ installed: true, running: true }),
      ...change,
    };
  }

  it("gathers what a real machine showed", async () => {
    const facts = await collectDoctorFacts(options());
    expect(facts).toMatchObject({
      proxyPid: 3694271,
      proxyOwner: "root",
      caFile: "/home/dev/.portless/ca.pem",
      // No ~/.pki/nssdb in the fixture.
      browserTrust: "no-store",
      studioPort: { port: 4949, holder: { kind: "studio" } },
      configError: null,
    });
    expect(facts.proxyProcesses).toHaveLength(2);
  });

  it("builds paths for the platform it describes", async () => {
    const facts = await collectDoctorFacts(
      options({ platform: "win32", stateDir: "C:\\Users\\dev\\.portless" }),
    );
    expect(facts.caFile).toBe("C:\\Users\\dev\\.portless\\ca.pem");
  });

  it("reports certutil missing when the NSS store exists", async () => {
    const io = linuxIo(async () => ({ exitCode: null, stdout: "" }));
    const withStore: SystemIo = {
      ...io,
      readDir: (path) => (path === "/home/dev/.pki/nssdb" ? ["cert9.db"] : io.readDir(path)),
    };
    expect((await collectDoctorFacts(options({ io: withStore }))).browserTrust).toBe("no-certutil");
  });

  it("names another program on Studio's port", async () => {
    const facts = await collectDoctorFacts(
      options({
        listPorts: async () => [{ port: 4949, pid: 88, processName: "java", cwd: null }],
        probe: async () => null,
      }),
    );
    expect(facts.studioPort.holder).toEqual({ kind: "other", pid: 88, processName: "java" });
  });

  it("falls back to the defaults and keeps the error when the config is broken", async () => {
    const configStore: ConfigStore = {
      path: "/x/config.json",
      read: async () => err({ code: "invalid_config", message: '"port" must be a number.' }),
      write: async () => ok(undefined),
      watch: () => () => {},
    };
    const facts = await collectDoctorFacts(options({ configStore }));
    expect(facts.configError).toBe('"port" must be a number.');
    expect(facts.config).toEqual(DEFAULT_CONFIG);
  });
});

describe("collectDoctorFacts on macOS and Windows", () => {
  const httpsState: PortlessState = {
    proxy: { running: true, port: 1355, https: true, tlds: ["localhost"] },
    portless: { installed: true, version: "0.15.11" },
    routes: [],
    readAt: 1,
  };

  function options(
    platform: NodeJS.Platform,
    run: SystemIo["run"],
    change: Partial<DoctorFactsOptions> = {},
  ): DoctorFactsOptions {
    return {
      platform,
      homeDir: "/Users/dev",
      stateDir: "/Users/dev/.portless",
      uid: platform === "win32" ? null : 501,
      registry: {
        readSnapshot: async () => httpsState,
        proxyPid: async () => 612,
      } as unknown as RouteRegistry,
      configStore: {
        path: "/Users/dev/.config/portless-studio/config.json",
        read: async () => ok(DEFAULT_CONFIG),
        write: async () => ok(undefined),
        watch: () => () => {},
      },
      processes: { ownerOf: async () => "you", terminate: async () => ok(undefined) },
      io: { readFile: () => null, readDir: () => [], readLink: () => null, run },
      listPorts: async () => [],
      probe: async () => null,
      canBind: async () => true,
      ...change,
    };
  }

  it("reads trust from the keychain on macOS without changing it", async () => {
    const calls: string[] = [];
    const found = async (bin: string, args: string[]) => {
      calls.push([bin, ...args].join(" "));
      return { exitCode: bin === "security" ? 0 : null, stdout: "" };
    };
    expect((await collectDoctorFacts(options("darwin", found))).browserTrust).toBe("trusted");
    expect(calls).toContain("security find-certificate -c portless");
    const missing = async (bin: string) => ({
      exitCode: bin === "security" ? 44 : null,
      stdout: "",
    });
    expect((await collectDoctorFacts(options("darwin", missing))).browserTrust).toBe("not-trusted");
  });

  it("reads trust from the Windows Root stores", async () => {
    const calls: string[] = [];
    const run = async (bin: string, args: string[]) => {
      calls.push([bin, ...args].join(" "));
      const listed = args.includes("-user") ? "Subject: CN=portless Local CA\r\n" : "";
      return { exitCode: 0, stdout: listed };
    };
    expect((await collectDoctorFacts(options("win32", run))).browserTrust).toBe("trusted");
    expect(calls).toContain("certutil -user -verifystore Root");
    const none = async () => ({ exitCode: 0, stdout: "CertUtil: -verifystore command completed." });
    expect((await collectDoctorFacts(options("win32", none))).browserTrust).toBe("not-trusted");
  });

  it("tries to bind Studio's port when lsof cannot see who holds it", async () => {
    const idle = async () => ({ exitCode: null, stdout: "" });
    const taken = await collectDoctorFacts(options("darwin", idle, { canBind: async () => false }));
    expect(taken.studioPort.holder).toEqual({ kind: "other", pid: null, processName: "" });
    const free = await collectDoctorFacts(options("darwin", idle));
    expect(free.studioPort.holder).toEqual({ kind: "free" });
  });
});

describe("proxyPidsAmong", () => {
  it("finds the portless proxies among listening pids on Linux, whatever port they use", async () => {
    const pids = await proxyPidsAmong("linux", linuxIo(), [3701892, 3706312, 4242]);
    expect(pids).toEqual(new Set([3701892]));
  });

  it("asks ps about just those pids on macOS", async () => {
    const calls: string[][] = [];
    const io = linuxIo(async (bin, args) => {
      calls.push([bin, ...args]);
      return {
        exitCode: 0,
        stdout: `  501   501 ${USER_PROXY.join(" ")}\n  777   501 /usr/local/bin/node server.js\n`,
      };
    });
    expect(await proxyPidsAmong("darwin", io, [501, 777])).toEqual(new Set([501]));
    expect(calls).toEqual([["ps", "-ww", "-o", "pid=,uid=,args=", "-p", "501,777"]]);
  });

  it("finds none on Windows or with no pids", async () => {
    expect(await proxyPidsAmong("win32", linuxIo(), [3701892])).toEqual(new Set());
    expect(await proxyPidsAmong("darwin", linuxIo(), [])).toEqual(new Set());
  });
});
