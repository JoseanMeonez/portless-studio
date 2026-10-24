import { type ChildProcess, spawn } from "node:child_process";
import type { SystemIo } from "./system-io.ts";
import {
  parseProcStatusUid,
  parseTasklistUser,
  SystemProcessControl,
} from "./system-process-control.ts";

function fakeIo(
  files: Record<string, string>,
  run: SystemIo["run"] = async () => noOutput,
): SystemIo {
  return {
    readFile: (path) => files[path] ?? null,
    readDir: () => [],
    readLink: () => null,
    run,
  };
}
const noOutput = { exitCode: 0, stdout: "" };

const STATUS = (uid: number) =>
  `Name:\tnode\nUmask:\t0002\nState:\tS (sleeping)\nPid:\t42\nUid:\t${uid}\t${uid}\t${uid}\t${uid}\nGid:\t1000\n`;

describe("parsers", () => {
  it("reads the real uid from /proc/<pid>/status", () => {
    expect(parseProcStatusUid(STATUS(1000))).toBe(1000);
    expect(parseProcStatusUid("Name:\tnode\n")).toBeNull();
  });

  it("reads the user name column of tasklist /v", () => {
    const row =
      '"node.exe","8120","Console","1","52,344 K","Running","DESKTOP-1\\\\dev","0:00:03","N/A"';
    expect(parseTasklistUser(row.replaceAll("\\\\", "\\"))).toBe("DESKTOP-1\\dev");
    expect(parseTasklistUser("INFO: No tasks are running which match the criteria.")).toBeNull();
  });
});

describe("ownerOf", () => {
  it("tells root, the current user and others apart on Linux", async () => {
    const io = fakeIo({
      "/proc/1/status": STATUS(0),
      "/proc/2/status": STATUS(1000),
      "/proc/3/status": STATUS(1001),
    });
    const control = new SystemProcessControl({ platform: "linux", io, uid: 1000, userName: "dev" });
    expect(await control.ownerOf(1)).toBe("root");
    expect(await control.ownerOf(2)).toBe("you");
    expect(await control.ownerOf(3)).toBe("other");
    expect(await control.ownerOf(4)).toBe("unknown");
  });

  it("asks ps for the uid on macOS", async () => {
    const calls: string[] = [];
    const io = fakeIo({}, async (bin, args) => {
      calls.push(`${bin} ${args.join(" ")}`);
      return { exitCode: 0, stdout: "  501\n" };
    });
    const control = new SystemProcessControl({ platform: "darwin", io, uid: 501, userName: "dev" });
    expect(await control.ownerOf(77)).toBe("you");
    expect(calls).toEqual(["ps -o uid= -p 77"]);
  });

  it("compares the tasklist user with the current one on Windows", async () => {
    const io = fakeIo({}, async () => ({
      exitCode: 0,
      stdout: '"node.exe","8120","Console","1","52,344 K","Running","PC\\dev","0:00:03","N/A"\r\n',
    }));
    const control = new SystemProcessControl({ platform: "win32", io, uid: null, userName: "dev" });
    expect(await control.ownerOf(8120)).toBe("you");
  });
});

describe("terminate", () => {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  /** A real child of this test, never a process of the machine; `ready` once it runs. */
  async function startChild(ignoreSigterm: boolean) {
    const code = ignoreSigterm
      ? "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"
      : "console.log('ready');setInterval(()=>{},1000)";
    const child = spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "ignore"] });
    children.push(child);
    await new Promise<void>((resolve) => child.stdout?.once("data", () => resolve()));
    const exited = new Promise<NodeJS.Signals | null>((resolve) =>
      child.once("exit", (_code, signal) => resolve(signal)),
    );
    return { pid: child.pid as number, exited };
  }

  const control = () =>
    new SystemProcessControl({
      platform: process.platform,
      io: fakeIo({}),
      uid: process.getuid?.() ?? null,
      userName: "dev",
      graceMs: 300,
      pollMs: 20,
    });

  it.skipIf(process.platform === "win32")("stops a process with SIGTERM", async () => {
    const child = await startChild(false);
    expect(await control().terminate(child.pid)).toEqual({ ok: true, value: undefined });
    expect(await child.exited).toBe("SIGTERM");
  });

  it.skipIf(process.platform === "win32")(
    "sends SIGKILL when the process ignores SIGTERM for the grace period",
    async () => {
      const child = await startChild(true);
      expect((await control().terminate(child.pid)).ok).toBe(true);
      expect(await child.exited).toBe("SIGKILL");
    },
  );
});
