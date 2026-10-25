import { decodePowershellScript } from "./powershell.ts";
import type { SystemIo } from "./system-io.ts";
import {
  folderFromCommandLine,
  listWindowsPorts,
  parseNetstat,
  parseTasklist,
  parseWin32Processes,
  splitWindowsCommandLine,
} from "./windows-ports.ts";

// `netstat -ano -p TCP` on Windows 11.
const NETSTAT_V4 = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
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

// `Get-CimInstance Win32_Process | Select-Object ... | ConvertTo-Json -Compress`.
const WIN32_PROCESSES = JSON.stringify([
  {
    ProcessId: 1032,
    Name: "svchost.exe",
    ExecutablePath: "C:\\Windows\\system32\\svchost.exe",
    CommandLine: "C:\\Windows\\system32\\svchost.exe -k RPCSS -p",
  },
  {
    ProcessId: 8120,
    Name: "node.exe",
    ExecutablePath: "C:\\Program Files\\nodejs\\node.exe",
    StartedAt: 1_792_843_200_000,
    CommandLine:
      '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\dev\\Proyectos\\tienda ñ\\node_modules\\vite\\bin\\vite.js" --port 5173',
  },
  { ProcessId: 9001, Name: "Code.exe", ExecutablePath: null, CommandLine: null },
]);

describe("parseNetstat", () => {
  it("keeps listening rows, whatever the language of the state column", () => {
    expect(parseNetstat(NETSTAT_V4)).toEqual([
      { port: 135, pid: 1032 },
      { port: 445, pid: 4 },
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

describe("parseWin32Processes", () => {
  it("reads a list, or the single object PowerShell prints for one process", () => {
    expect(parseWin32Processes(WIN32_PROCESSES).get(8120)).toEqual({
      name: "node",
      executable: "C:\\Program Files\\nodejs\\node.exe",
      commandLine: expect.stringContaining("vite.js"),
      startedAt: 1_792_843_200_000,
    });
    const one = JSON.stringify({ ProcessId: 7, Name: "python.exe", ExecutablePath: null });
    expect(parseWin32Processes(one).get(7)).toEqual({
      name: "python",
      executable: null,
      commandLine: null,
    });
    expect(parseWin32Processes("not json").size).toBe(0);
  });
});

describe("splitWindowsCommandLine", () => {
  it("follows the Windows rules for quotes and backslashes", () => {
    expect(splitWindowsCommandLine('"C:\\Program Files\\x.exe" a\\\\"b c" "d\\"e" f')).toEqual([
      "C:\\Program Files\\x.exe",
      "a\\b c",
      'd"e',
      "f",
    ]);
  });
});

describe("folderFromCommandLine", () => {
  it("takes the project folder from the script a runtime runs", () => {
    expect(
      folderFromCommandLine(
        '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\dev\\shop\\node_modules\\.bin\\..\\next\\dist\\bin\\next dev',
      ),
    ).toBe("C:\\Users\\dev\\shop");
    expect(folderFromCommandLine("node.exe --watch C:\\Users\\dev\\api\\server.mjs")).toBe(
      "C:\\Users\\dev\\api",
    );
  });

  it("has no folder for a relative script or no script at all", () => {
    expect(folderFromCommandLine("python.exe manage.py runserver")).toBeNull();
    expect(folderFromCommandLine("C:\\Windows\\system32\\svchost.exe -k RPCSS")).toBeNull();
    expect(folderFromCommandLine(null)).toBeNull();
  });
});

function fakeIo(powershell: { exitCode: number | null; stdout: string }) {
  const calls: { bin: string; args: string[] }[] = [];
  const io: SystemIo = {
    readFile: () => null,
    readDir: () => [],
    readLink: () => null,
    run: async (bin, args) => {
      calls.push({ bin, args });
      if (bin === "powershell") return powershell;
      if (bin === "tasklist") return { exitCode: 0, stdout: TASKLIST };
      return { exitCode: 0, stdout: args.includes("TCPv6") ? NETSTAT_V6 : NETSTAT_V4 };
    },
  };
  return { io, calls };
}

describe("listWindowsPorts", () => {
  it("joins netstat with one Win32_Process query for names, paths and folders", async () => {
    const { io, calls } = fakeIo({ exitCode: 0, stdout: WIN32_PROCESSES });
    expect(await listWindowsPorts(io)).toEqual([
      {
        port: 135,
        pid: 1032,
        processName: "svchost",
        cwd: null,
        executable: "C:\\Windows\\system32\\svchost.exe",
      },
      // The kernel (pid 4) owns ports like 445; it is never a dev server.
      { port: 445, pid: null, processName: "System", cwd: null, executable: null },
      { port: 4321, pid: 9001, processName: "Code", cwd: null, executable: null },
      {
        port: 5173,
        pid: 8120,
        processName: "node",
        cwd: "C:\\Users\\dev\\Proyectos\\tienda ñ",
        executable: "C:\\Program Files\\nodejs\\node.exe",
        // From Win32_Process CreationDate.
        startedAt: 1_792_843_200_000,
      },
    ]);
    const queries = calls.filter((call) => call.bin === "powershell");
    expect(queries).toHaveLength(1);
    expect(decodePowershellScript(queries[0]?.args ?? [])).toContain("CreationDate");
    expect(decodePowershellScript(queries[0]?.args ?? [])).toContain(
      "ProcessId=1032 OR ProcessId=8120 OR ProcessId=9001",
    );
    expect(calls.some((call) => call.bin === "tasklist")).toBe(false);
  });

  it("asks PowerShell again only about processes it has not seen recently", async () => {
    const { io, calls } = fakeIo({ exitCode: 0, stdout: WIN32_PROCESSES });
    const cache = new Map();
    let now = 1_000;
    await listWindowsPorts(io, cache, () => now);
    await listWindowsPorts(io, cache, () => now);
    expect(calls.filter((call) => call.bin === "powershell")).toHaveLength(1);
    now += 60_000;
    await listWindowsPorts(io, cache, () => now);
    expect(calls.filter((call) => call.bin === "powershell")).toHaveLength(2);
  });

  it("falls back to tasklist names when PowerShell cannot run", async () => {
    const { io } = fakeIo({ exitCode: null, stdout: "" });
    const ports = await listWindowsPorts(io);
    expect(ports.find((port) => port.port === 5173)).toEqual({
      port: 5173,
      pid: 8120,
      processName: "node",
      cwd: null,
      executable: null,
    });
  });
});
