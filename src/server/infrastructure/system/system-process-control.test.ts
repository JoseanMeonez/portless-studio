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

describe("terminate on Windows", () => {
  const PID = 4242;

  function windowsControl(answers: { exitCode: number; output: string }[]) {
    const calls: string[] = [];
    let forced = false;
    const io = fakeIo({}, async (bin, args) => {
      calls.push(`${bin} ${args.join(" ")}`);
      if (args.includes("/F")) forced = true;
      const answer = answers.shift() ?? { exitCode: 0, output: "SUCCESS" };
      return { exitCode: answer.exitCode, stdout: "", output: answer.output };
    });
    const control = new SystemProcessControl({
      platform: "win32",
      io,
      uid: null,
      userName: "dev",
      graceMs: 5000,
      pollMs: 10,
      isAlive: () => !forced,
    });
    return { control, calls };
  }

  it("forces at once when taskkill says the process only stops forcefully", async () => {
    const { control, calls } = windowsControl([
      {
        exitCode: 1,
        output:
          "ERROR: The process with PID 4242 could not be terminated.\r\n" +
          "Reason: This process can only be terminated forcefully (with /F option).\r\n",
      },
    ]);
    const started = Date.now();
    expect(await control.terminate(PID)).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual(["taskkill /PID 4242 /T", "taskkill /F /PID 4242 /T"]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("reports access denied as not allowed, with the Administrator command", async () => {
    const { control, calls } = windowsControl([
      {
        exitCode: 1,
        output:
          "ERROR: The process with PID 4242 could not be terminated.\r\nReason: Access is denied.\r\n",
      },
    ]);
    const result = await control.terminate(PID);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "process_not_allowed",
        message: expect.stringContaining("Administrator"),
        command: "taskkill /F /PID 4242",
      },
    });
    expect(calls).toEqual(["taskkill /PID 4242 /T"]);
  });

  it("counts a process that is already gone as stopped", async () => {
    const { control, calls } = windowsControl([
      { exitCode: 128, output: 'ERROR: The process "4242" not found.\r\n' },
    ]);
    expect(await control.terminate(PID)).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual(["taskkill /PID 4242 /T"]);
  });
});

describe("development command trees", () => {
  it.each(["linux", "darwin", "win32"] as const)(
    "reads the %s OS table and keeps the shell outside the stop tree",
    async (platform) => {
      const entries = [
        { pid: 10, parent: 1, command: platform === "win32" ? "cmd.exe" : "bash" },
        {
          pid: 20,
          parent: 10,
          command:
            platform === "win32"
              ? 'node.exe "C:\\tools\\npm-cli.js" run dev'
              : "node /tools/npm-cli.js run dev",
        },
        {
          pid: 30,
          parent: 20,
          command: platform === "win32" ? "cmd.exe /d /s /c vite" : "sh -c vite",
        },
        { pid: 40, parent: 30, command: "node /tools/vite.js" },
        { pid: 50, parent: 20, command: "node worker.js" },
      ];
      const files: Record<string, string> = {};
      for (const entry of entries) {
        files[`/proc/${entry.pid}/stat`] = `${entry.pid} (node) S ${entry.parent} 0 0`;
        files[`/proc/${entry.pid}/cmdline`] = entry.command.replaceAll(" ", "\0");
      }
      const run = vi.fn(async () => ({
        exitCode: 0,
        stdout:
          platform === "win32"
            ? JSON.stringify(
                entries.map((entry) => ({
                  ProcessId: entry.pid,
                  ParentProcessId: entry.parent,
                  CommandLine: entry.command,
                })),
              )
            : entries.map((entry) => `${entry.pid} ${entry.parent} ${entry.command}`).join("\n"),
      }));
      const io = {
        ...fakeIo(files, run),
        readDir: () => entries.map((entry) => String(entry.pid)),
      };
      const control = new SystemProcessControl({ platform, io, uid: 1000, userName: "dev" });
      expect(await control.devTree(40)).toEqual([20, 40, 50, 30]);
      if (platform === "darwin")
        expect(run).toHaveBeenCalledWith("ps", ["-ww", "-axo", "pid=,ppid=,args="]);
      if (platform === "win32") expect(run.mock.calls.length).toBe(1);
    },
  );
});
