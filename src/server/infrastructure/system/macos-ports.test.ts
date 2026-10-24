import { listMacosPorts, parseLsofCwds, parseLsofListen } from "./macos-ports.ts";
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
  it("runs lsof twice and joins ports with folders", async () => {
    const calls: string[] = [];
    const io: SystemIo = {
      readFile: () => null,
      readDir: () => [],
      readLink: () => null,
      run: async (bin, args) => {
        calls.push(`${bin} ${args.join(" ")}`);
        return { exitCode: 0, stdout: args.includes("cwd") ? CWDS : LISTEN };
      },
    };
    expect(await listMacosPorts(io)).toEqual([
      { port: 5173, pid: 812, processName: "node", cwd: "/Users/ana/acme/apps/app" },
      { port: 5432, pid: 913, processName: "postgres", cwd: "/usr/local/var/postgres" },
      { port: 7000, pid: 1004, processName: "ControlCenter", cwd: null },
    ]);
    expect(calls).toEqual([
      "lsof -nP -iTCP -sTCP:LISTEN -F pcn",
      "lsof -a -d cwd -p 812,913,1004 -F pn",
    ]);
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
