import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** How a command is started: the file, its arguments, and whether Node may re-quote them. */
export type SpawnPlan = { file: string; args: string[]; windowsVerbatimArguments: boolean };

/** What finding a command on Windows reads; tests replace it with a fixed list of files. */
export type WindowsLookup = {
  pathDirs: string[];
  pathExts: string[];
  exists(file: string): boolean;
  comSpec: string;
};

export type RunOutcome = {
  /** null when the process could not start or was stopped after its timeout. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr in the order they arrived. */
  combined: string;
  /** True when the command does not exist on this machine. */
  missing: boolean;
  timedOut: boolean;
  /** The spawn error message, when the process could not start. */
  error?: string;
};

export type RunProcessOptions = {
  env?: NodeJS.ProcessEnv;
  /** Attach this terminal, so the command can ask for a password or draw its own UI. */
  inherit?: boolean;
  /** Stops the command, and on Windows its whole process tree, after this long. */
  timeoutMs?: number;
  platform?: NodeJS.Platform;
};

// cmd.exe exits with 9009 when the command it was asked to run does not exist.
const WINDOWS_COMMAND_NOT_FOUND = 9009;
/** Output still in the pipes when a process exits arrives right after; a child holding them does not. */
const DRAIN_AFTER_EXIT_MS = 1000;
// Characters cmd.exe reads specially, escaped with `^` so they reach the program as text.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const DIRECT_EXTENSIONS = new Set([".exe", ".com"]);
const BATCH_EXTENSIONS = new Set([".cmd", ".bat"]);

/**
 * How to start `bin` with `args`. Outside Windows, directly. On Windows, an `.exe` found on PATH
 * (netstat, tasklist, powershell) starts directly too; a `.cmd` or `.bat` shim (npm, portless)
 * and an unknown name go through cmd.exe with every part quoted, so paths with spaces and
 * characters like `&` stay one argument.
 */
export function planSpawn(
  bin: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  lookup: WindowsLookup = nodeWindowsLookup(),
): SpawnPlan {
  if (platform !== "win32") return { file: bin, args, windowsVerbatimArguments: false };

  const resolved = resolveWindowsCommand(bin, lookup);
  const extension = path.win32.extname(resolved ?? bin).toLowerCase();
  if (resolved && DIRECT_EXTENSIONS.has(extension)) {
    return { file: resolved, args, windowsVerbatimArguments: false };
  }
  // A shim hands its arguments on with %*, which cmd.exe reads a second time.
  const twice = BATCH_EXTENSIONS.has(extension);
  const line = [
    (resolved ?? bin).replace(CMD_META, "^$1"),
    ...args.map((arg) => quoteCmdArgument(arg, twice)),
  ].join(" ");
  return {
    file: lookup.comSpec,
    args: ["/d", "/s", "/c", `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * One argument for a program started through cmd.exe: quoted for the program's own parser
 * (backslashes before a quote doubled, quotes escaped), then every cmd.exe character escaped.
 */
export function quoteCmdArgument(arg: string, twice: boolean): string {
  let quoted = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  quoted = `"${quoted}"`.replace(CMD_META, "^$1");
  return twice ? quoted.replace(CMD_META, "^$1") : quoted;
}

/** The file Windows would run for `bin`: as given with an extension, or found with PATHEXT. */
export function resolveWindowsCommand(bin: string, lookup: WindowsLookup): string | null {
  const hasDir = /[\\/]/.test(bin);
  const dirs = hasDir ? [""] : lookup.pathDirs;
  const hasExtension = path.win32.extname(bin) !== "";
  for (const dir of dirs) {
    const base = dir === "" ? bin : path.win32.join(dir, bin);
    if (hasExtension && lookup.exists(base)) return base;
    for (const extension of lookup.pathExts) {
      const candidate = `${base}${extension.toLowerCase()}`;
      if (lookup.exists(candidate)) return candidate;
    }
  }
  return null;
}

const found = new Map<string, boolean>();

function nodeWindowsLookup(): WindowsLookup {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  return {
    pathDirs: pathValue
      .split(";")
      .map((dir) => dir.replace(/^"|"$/g, "").trim())
      .filter(Boolean),
    pathExts: (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean),
    // Only hits are remembered: a command installed later (portless from the page) must be found.
    exists: (file) => {
      if (found.get(file)) return true;
      const hit = fs.existsSync(file) && fs.statSync(file).isFile();
      if (hit) found.set(file, true);
      return hit;
    },
    comSpec: process.env.ComSpec ?? "cmd.exe",
  };
}

/**
 * The one way Studio starts a process and waits for it: portless, npm, the system tools the
 * scanners read and the CLI's commands. Output is read as UTF-8. On a timeout the process tree
 * is stopped (`taskkill /T /F` on Windows, where killing cmd.exe would leave its child running)
 * and the promise resolves right away; it never resolves twice.
 */
export function runProcess(
  bin: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<RunOutcome> {
  const platform = options.platform ?? process.platform;
  const plan = planSpawn(bin, args, platform);
  const viaCmd = plan.windowsVerbatimArguments;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let combined = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let drain: NodeJS.Timeout | undefined;

    const finish = (outcome: Partial<RunOutcome> & { exitCode: number | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      resolve({
        stdout,
        stderr,
        combined,
        missing: false,
        timedOut: false,
        ...outcome,
      });
    };

    const child = spawn(plan.file, plan.args, {
      ...(options.env === undefined ? {} : { env: options.env }),
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: !options.inherit,
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });

    for (const [stream, append] of [
      [child.stdout, (text: string) => (stdout += text)],
      [child.stderr, (text: string) => (stderr += text)],
    ] as const) {
      // A string decoder keeps a character split across two chunks whole.
      stream?.setEncoding("utf8");
      stream?.on("data", (text: string) => {
        append(text);
        combined += text;
      });
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ exitCode: null, missing: error.code === "ENOENT", error: error.message });
    });
    child.on("exit", (exitCode) => {
      drain = setTimeout(() => finish(exitOutcome(exitCode, viaCmd)), DRAIN_AFTER_EXIT_MS);
    });
    child.on("close", (exitCode) => finish(exitOutcome(exitCode, viaCmd)));

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        stopProcessTree(child.pid, platform, () => child.kill("SIGTERM"));
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({ exitCode: null, timedOut: true });
      }, options.timeoutMs);
    }
  });
}

function exitOutcome(
  exitCode: number | null,
  viaCmd: boolean,
): { exitCode: number | null; missing: boolean } {
  return { exitCode, missing: viaCmd && exitCode === WINDOWS_COMMAND_NOT_FOUND };
}

/**
 * Stops a process and, on Windows, every process it started (`taskkill /T /F`); elsewhere calls
 * `kill`, which the caller aims at the process or its group.
 */
export function stopProcessTree(
  pid: number | undefined,
  platform: NodeJS.Platform,
  kill: () => void,
): void {
  if (platform !== "win32" || pid === undefined) {
    kill();
    return;
  }
  const plan = planSpawn("taskkill", ["/T", "/F", "/PID", String(pid)], platform);
  const killer = spawn(plan.file, plan.args, {
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: plan.windowsVerbatimArguments,
  });
  killer.on("error", kill);
}
