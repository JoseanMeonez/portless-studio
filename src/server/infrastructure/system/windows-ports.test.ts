import type { SystemIo } from "./system-io.ts";
import { listWindowsPorts, parseNetstat, parseTasklist } from "./windows-ports.ts";

// `netstat -ano -p TCP` on Windows 11.
const NETSTAT_V4 = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       8120
  TCP    127.0.0.1:5173         127.0.0.1:50001        ESTABLISHED     8120
  TCP    192.168.1.20:50002     140.82.112.4:443       ESTABLISHED     4410
`;

// `netstat -ano -p TCPv6`, on a German Windows: the state column is translated.
const NETSTAT_V6 = `
Aktive Verbindungen

  Proto  Lokale Adresse         Remoteadresse          Status           PID
  TCP    [::]:135               [::]:0                 ABHÖREN         1032
  TCP    [::1]:5173             [::]:0                 ABHÖREN         8120
  TCP    [::1]:4321             [::]:0                 ABHÖREN         9001
`;

const TASKLIST = `"System Idle Process","0","Services","0","8 K"
"svchost.exe","1032","Services","0","12,404 K"
"node.exe","8120","Console","1","95,432 K"
"Code.exe","9001","Console","1","301,220 K"
`;

describe("parseNetstat", () => {
  it("keeps listening rows, whatever the language of the state column", () => {
    expect(parseNetstat(NETSTAT_V4)).toEqual([
      { port: 135, pid: 1032 },
      { port: 5173, pid: 8120 },
    ]);
    expect(parseNetstat(NETSTAT_V6)).toEqual([
      { port: 135, pid: 1032 },
      { port: 5173, pid: 8120 },
      { port: 4321, pid: 9001 },
    ]);
  });
});

describe("parseTasklist", () => {
  it("maps pids to process names without .exe", () => {
    const names = parseTasklist(TASKLIST);
    expect(names.get(8120)).toBe("node");
    expect(names.get(9001)).toBe("Code");
    expect(names.get(0)).toBe("System Idle Process");
  });
});

describe("listWindowsPorts", () => {
  it("joins both netstat tables with tasklist and has no folders", async () => {
    const io: SystemIo = {
      readFile: () => null,
      readDir: () => [],
      readLink: () => null,
      run: async (bin, args) => {
        if (bin === "tasklist") return { exitCode: 0, stdout: TASKLIST };
        return { exitCode: 0, stdout: args.includes("TCPv6") ? NETSTAT_V6 : NETSTAT_V4 };
      },
    };
    expect(await listWindowsPorts(io)).toEqual([
      { port: 135, pid: 1032, processName: "svchost", cwd: null },
      { port: 4321, pid: 9001, processName: "Code", cwd: null },
      { port: 5173, pid: 8120, processName: "node", cwd: null },
    ]);
  });
});
