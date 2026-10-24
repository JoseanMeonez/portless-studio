import { listLinuxPorts, parseProcNetTcp } from "./linux-ports.ts";
import type { SystemIo } from "./system-io.ts";

const TCP = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 111 1 0000000000000000 100 0 0 10 0
   1: 00000000:10E1 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 222 1 0000000000000000 100 0 0 10 0
   2: 0100007F:1435 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 0 1 0000000000000000 20 4 30 10 -1
   3: 0100007F:0CEA 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 333 1 0000000000000000 100 0 0 10 0
`;

const TCP6 = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000001000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 444 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000000000000:1371 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 555 1 0000000000000000 100 0 0 10 0
`;

describe("parseProcNetTcp", () => {
  it("keeps only LISTEN rows with their port and socket inode", () => {
    expect(parseProcNetTcp(TCP)).toEqual([
      { port: 5173, inode: "111" },
      { port: 4321, inode: "222" },
      { port: 3306, inode: "333" },
    ]);
  });

  it("reads IPv6 rows", () => {
    expect(parseProcNetTcp(TCP6)).toEqual([
      { port: 5173, inode: "444" },
      { port: 4977, inode: "555" },
    ]);
  });

  it("ignores headers, blank lines and garbage", () => {
    expect(parseProcNetTcp("nothing here\n\n  0: zz:zz 0A")).toEqual([]);
  });
});

function fakeProc(): SystemIo {
  const files: Record<string, string> = {
    "/proc/net/tcp": TCP,
    "/proc/net/tcp6": TCP6,
    // Node renames its main thread, so comm is not the executable for Node servers.
    "/proc/100/comm": "MainThread\n",
    "/proc/200/comm": "ng\n",
  };
  const dirs: Record<string, string[]> = {
    "/proc": ["1", "100", "200", "300", "self", "cpuinfo"],
    "/proc/100/fd": ["0", "1", "20", "21"],
    "/proc/200/fd": ["0", "30"],
    // pid 300 belongs to another user: its fd folder cannot be listed.
  };
  const links: Record<string, string> = {
    "/proc/100/fd/0": "/dev/null",
    "/proc/100/fd/1": "pipe:[9]",
    "/proc/100/fd/20": "socket:[111]",
    "/proc/100/fd/21": "socket:[444]",
    "/proc/100/cwd": "/home/ana/acme/apps/app",
    "/proc/100/exe": "/home/ana/.nvm/versions/node/v24.1.0/bin/node",
    "/proc/200/fd/0": "/dev/null",
    "/proc/200/fd/30": "socket:[222]",
    "/proc/200/cwd": "/home/ana/old-site (deleted)",
  };
  return {
    readFile: (p) => files[p] ?? null,
    readDir: (p) => dirs[p] ?? [],
    readLink: (p) => links[p] ?? null,
    run: async () => ({ exitCode: null, stdout: "" }),
  };
}

describe("listLinuxPorts", () => {
  it("maps socket inodes to processes, names and folders", async () => {
    const ports = await listLinuxPorts(fakeProc());
    expect(ports).toEqual(
      expect.arrayContaining([
        { port: 5173, pid: 100, processName: "node", cwd: "/home/ana/acme/apps/app" },
        { port: 4321, pid: 200, processName: "ng", cwd: null },
        { port: 3306, pid: null, processName: "", cwd: null },
        { port: 4977, pid: null, processName: "", cwd: null },
      ]),
    );
  });

  it("lists a port open on IPv4 and IPv6 once", async () => {
    const ports = await listLinuxPorts(fakeProc());
    expect(ports.filter((p) => p.port === 5173)).toHaveLength(1);
    expect(ports.map((p) => p.port)).toEqual([3306, 4321, 4977, 5173]);
  });
});
