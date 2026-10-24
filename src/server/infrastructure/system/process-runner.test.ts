import { planSpawn, quoteCmdArgument, runProcess, type WindowsLookup } from "./process-runner.ts";

const COMSPEC = "C:\\Windows\\system32\\cmd.exe";

function windows(files: string[]): WindowsLookup {
  const known = new Set(files.map((file) => file.toLowerCase()));
  return {
    pathDirs: ["C:\\Windows\\System32", "C:\\Users\\dev\\AppData\\Roaming\\npm"],
    pathExts: [".COM", ".EXE", ".BAT", ".CMD"],
    exists: (file) => known.has(file.toLowerCase()),
    comSpec: COMSPEC,
  };
}

describe("planSpawn", () => {
  it("starts the binary itself outside Windows", () => {
    expect(planSpawn("portless", ["alias", "web", "5173"], "linux")).toEqual({
      file: "portless",
      args: ["alias", "web", "5173"],
      windowsVerbatimArguments: false,
    });
  });

  it("starts a Windows system tool directly, without cmd.exe", () => {
    const lookup = windows(["C:\\Windows\\System32\\netstat.exe"]);
    expect(planSpawn("netstat", ["-ano", "-p", "TCP"], "win32", lookup)).toEqual({
      file: "C:\\Windows\\System32\\netstat.exe",
      args: ["-ano", "-p", "TCP"],
      windowsVerbatimArguments: false,
    });
  });

  it("runs a .cmd shim through cmd.exe with every part quoted", () => {
    const lookup = windows(["C:\\Program Files\\nodejs\\npm.cmd"]);
    const plan = planSpawn(
      "C:\\Program Files\\nodejs\\npm.cmd",
      ["install", "-g"],
      "win32",
      lookup,
    );
    expect(plan.file).toBe(COMSPEC);
    expect(plan.windowsVerbatimArguments).toBe(true);
    expect(plan.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    // A shim passes its arguments on with %*, which cmd.exe reads again: escaped twice.
    expect(plan.args[3]).toBe('"C:\\Program^ Files\\nodejs\\npm.cmd ^^^"install^^^" ^^^"-g^^^""');
  });

  it("finds a bare name's .cmd shim on PATH", () => {
    const lookup = windows(["C:\\Users\\dev\\AppData\\Roaming\\npm\\portless.cmd"]);
    const plan = planSpawn("portless", ["--version"], "win32", lookup);
    expect(plan.file).toBe(COMSPEC);
    expect(plan.args[3]).toBe(
      '"C:\\Users\\dev\\AppData\\Roaming\\npm\\portless.cmd ^^^"--version^^^""',
    );
  });

  it("leaves an unknown bare name to cmd.exe, so a missing command reports 9009", () => {
    const plan = planSpawn("portless", ["--version"], "win32", windows([]));
    expect(plan.file).toBe(COMSPEC);
    expect(plan.args[3]).toBe('"portless ^"--version^""');
  });
});

describe("quoteCmdArgument", () => {
  it("keeps spaces and & inside one argument", () => {
    expect(quoteCmdArgument("a b&c", false)).toBe('^"a^ b^&c^"');
  });

  it("escapes quotes and the backslashes before them for the program's parser", () => {
    expect(quoteCmdArgument('say "hi"', false)).toBe('^"say^ \\^"hi\\^"^"');
    expect(quoteCmdArgument("C:\\dir\\", false)).toBe('^"C:\\dir\\\\^"');
  });
});

describe("runProcess", () => {
  const node = process.execPath;

  it("returns stdout and the exit code", async () => {
    const outcome = await runProcess(node, ["-e", "process.stdout.write('héllo')"]);
    expect(outcome).toMatchObject({
      exitCode: 0,
      stdout: "héllo",
      missing: false,
      timedOut: false,
    });
  });

  it("reports a binary that does not exist as missing", async () => {
    const outcome = await runProcess("portless-studio-no-such-binary", []);
    expect(outcome.missing).toBe(true);
  });

  it("reports a Windows command PATH cannot find as missing without starting cmd.exe", async () => {
    const lookup = windows([]);
    for (const bin of ["portless", "C:\\tools\\no-such-portless"]) {
      const outcome = await runProcess(bin, ["--version"], { platform: "win32", lookup });
      expect(outcome).toMatchObject({
        exitCode: null,
        missing: true,
        timedOut: false,
        error: `Command not found: ${bin}`,
      });
    }
  });

  it("stops a command that runs past its timeout and resolves once", async () => {
    const started = Date.now();
    const outcome = await runProcess(node, ["-e", "setTimeout(() => {}, 10000)"], {
      timeoutMs: 200,
    });
    expect(outcome).toMatchObject({ exitCode: null, timedOut: true });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("does not wait for a child process that keeps the output open", async () => {
    // The command exits at once; the process it leaves behind holds stdout for 3 seconds.
    const script =
      "require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 3000)']," +
      " { stdio: 'inherit', detached: true }).unref(); process.stdout.write('done')";
    const started = Date.now();
    const outcome = await runProcess(node, ["-e", script], { timeoutMs: 10_000 });
    expect(outcome).toMatchObject({ exitCode: 0, stdout: "done", timedOut: false });
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
