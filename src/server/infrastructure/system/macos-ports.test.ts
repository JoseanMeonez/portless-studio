import {
  listMacosPorts,
  parseLsofCwds,
  parseLsofListen,
  parsePsExecutables,
  parsePsStartTimes,
} from "./macos-ports.ts";
import type { SystemIo } from "./system-io.ts";

// `lsof -nP -iTCP -sTCP:LISTEN -F pcn` on macOS 15.
const LISTEN = `p812
cnode
f23
n127.0.0.1:5173
f24
n[::1]:5173
p913
cpostgres
f7
n*:5432
f8
n[::]:5432
p1004
cControlCenter
f9
n*:7000
`;

// `lsof -a -d cwd -p 812,913,1004 -F pn`
const CWDS = `p812
fcwd
n/Users/ana/acme/apps/app
p913
fcwd
n/usr/local/var/postgres
`;

// `ps -ww -o pid=,comm= -p 812,913,1004`: comm is the full path, spaces included.
const EXECUTABLES = `  812 /Users/dev/.nvm/versions/node/v24.1.0/bin/node
  913 /opt/homebrew/opt/postgresql@16/bin/postgres
 1004 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter
 1200 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper
 1300 node
`;

const NOW = Date.UTC(2026, 9, 24, 12, 0, 0);

// `ps -o pid=,etime= -p 812,913,1004`: `[[dd-]hh:]mm:ss` since each process started.
const ELAPSED = `  812    02:13:00
  913 3-00:00:05
 1300       00:42
`;

describe("parsePsStartTimes", () => {
  it("subtracts the elapsed time from now, with or without days and hours", () => {
    const starts = parsePsStartTimes(ELAPSED, NOW);
    expect(starts.get(812)).toBe(NOW - (2 * 3600 + 13 * 60) * 1000);
    expect(starts.get(913)).toBe(NOW - 3 * 86_400_000 - 5000);
    expect(starts.get(1300)).toBe(NOW - 42_000);
    expect(parsePsStartTimes("garbage\n", NOW).size).toBe(0);
  });
});

describe("parsePsExecutables", () => {
  it("keeps full paths, spaces included, and skips bare names", () => {
    const executables = parsePsExecutables(EXECUTABLES);
    expect(executables.get(1200)).toBe(
      "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper",
    );
    expect(executables.get(812)).toBe("/Users/dev/.nvm/versions/node/v24.1.0/bin/node");
    expect(executables.has(1300)).toBe(false);
  });
});

describe("parseLsofListen", () => {
  it("reads one row per process and port", () => {
    expect(parseLsofListen(LISTEN)).toEqual([
      { port: 5173, pid: 812, processName: "node" },
      { port: 5173, pid: 812, processName: "node" },
      { port: 5432, pid: 913, processName: "postgres" },
      { port: 5432, pid: 913, processName: "postgres" },
      { port: 7000, pid: 1004, processName: "ControlCenter" },
    ]);
  });
});

describe("parseLsofCwds", () => {
  it("maps pids to their working folder", () => {
    expect(parseLsofCwds(CWDS)).toEqual(
      new Map([
        [812, "/Users/ana/acme/apps/app"],
        [913, "/usr/local/var/postgres"],
      ]),
    );
  });
});

describe("listMacosPorts", () => {
  it("joins ports with folders from lsof and executables from ps", async () => {
    const calls: string[] = [];
    const io: SystemIo = {
      readFile: () => null,
      readDir: () => [],
      readLink: () => null,
      run: async (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        if (bin === "ps") return { exitCode: 0, stdout: EXECUTABLES };
        return { exitCode: 0, stdout: args.includes("cwd") ? CWDS : LISTEN };
      },
    };
    expect(await listMacosPorts(io)).toEqual([
      {
        port: 5173,
        pid: 812,
        processName: "node",
        cwd: "/Users/ana/acme/apps/app",
        executable: "/Users/dev/.nvm/versions/node/v24.1.0/bin/node",
      },
      {
        port: 5432,
        pid: 913,
        processName: "postgres",
        cwd: "/usr/local/var/postgres",
        executable: "/opt/homebrew/opt/postgresql@16/bin/postgres",
      },
      {
        port: 7000,
        pid: 1004,
        processName: "ControlCenter",
        cwd: null,
        executable: "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
      },
    ]);
    expect(calls).toEqual([
      "lsof -nP -iTCP -sTCP:LISTEN -F pcn",
      "lsof -a -d cwd -p 812,913,1004 -F pn",
      "ps -ww -o pid=,comm= -p 812,913,1004",
      "ps -o pid=,etime= -p 812,913,1004",
    ]);
  });

  it("adds start times from ps etime and asks ps again only about new processes", async () => {
    const calls: string[] = [];
    const io: SystemIo = {
      readFile: () => null,
      readDir: () => [],
      readLink: () => null,
      run: async (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        if (bin === "ps" && args.includes("pid=,etime=")) return { exitCode: 0, stdout: ELAPSED };
        if (bin === "ps") return { exitCode: 0, stdout: EXECUTABLES };
        return { exitCode: 0, stdout: args.includes("cwd") ? CWDS : LISTEN };
      },
    };
    const cache = new Map();
    const ports = await listMacosPorts(io, cache, () => NOW);
    expect(ports.find((port) => port.pid === 812)?.startedAt).toBe(
      NOW - (2 * 3600 + 13 * 60) * 1000,
    );
    expect(ports.find((port) => port.pid === 913)?.startedAt).toBe(NOW - 3 * 86_400_000 - 5000);
    // ps printed nothing for 1004, so its start stays unknown.
    expect(ports.find((port) => port.pid === 1004)).not.toHaveProperty("startedAt");
    await listMacosPorts(io, cache, () => NOW + 60_000);
    expect(calls.filter((call) => call.includes("etime"))).toHaveLength(1);
  });

  it("returns nothing when lsof cannot run", async () => {
    const io: SystemIo = {
      readFile: () => null,
      readDir: () => [],
      readLink: () => null,
      run: async () => ({ exitCode: null, stdout: "" }),
    };
    expect(await listMacosPorts(io)).toEqual([]);
  });
});
