import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { TerminalMode } from "../../../core/terminals/terminal.ts";
import type {
  SpawnRequest,
  TerminalFolders,
  TerminalProcess,
  TerminalSpawner,
} from "../../application/terminals.ts";
import { runProcess, stopProcessTree } from "../system/process-runner.ts";

/** How one terminal command is started. Pure, so every platform's shape is tested anywhere. */
export type TerminalPlan = {
  file: string;
  args: string[];
  env: Record<string, string>;
  /** Own process group on Linux and macOS, so a stop reaches the whole tree. */
  detached: boolean;
  windowsVerbatimArguments: boolean;
};

export type PlanContext = {
  platform: NodeJS.Platform;
  mode: TerminalMode;
  /** The user's shell for interactive terminals; `SHELL`, else /bin/sh. */
  shell: string;
  /** cmd.exe on Windows. */
  comSpec: string;
};

/** Output still in the pipes when a process exits arrives right after; a child holding them does not. */
const DRAIN_AFTER_EXIT_MS = 500;

/**
 * Pseudo-terminal mode wraps the command in the system `script` command, which needs no native
 * module: util-linux `script -q -f -e -c <command> /dev/null` on Linux, BSD
 * `script -q /dev/null sh -c <command>` on macOS. `stty` inside the pseudo-terminal sets the size
 * the page asked for, since nothing outside can. Pipes mode runs `sh -c` (cmd.exe on Windows) with
 * `FORCE_COLOR=1`, because most tools turn colors off when stdout is not a terminal.
 */
export function planTerminal(request: SpawnRequest, context: PlanContext): TerminalPlan {
  const env: Record<string, string> = { ...request.env };
  if (context.platform === "win32") {
    env.FORCE_COLOR = "1";
    const args = request.command === null ? ["/d"] : ["/d", "/s", "/c", `"${request.command}"`];
    return {
      file: context.comSpec,
      args,
      env,
      detached: false,
      windowsVerbatimArguments: true,
    };
  }
  if (context.mode === "pipes") {
    env.FORCE_COLOR = "1";
    const args =
      request.command === null
        ? ["-c", `exec ${quote(context.shell)} -i`]
        : ["-c", request.command];
    return { file: "/bin/sh", args, env, detached: true, windowsVerbatimArguments: false };
  }
  const run = request.command ?? `exec ${quote(context.shell)}`;
  const inner = `stty cols ${request.cols} rows ${request.rows} 2>/dev/null; ${run}`;
  // util-linux script runs `$SHELL -c`; /bin/sh keeps the command's meaning the same everywhere.
  env.SHELL = "/bin/sh";
  const args =
    context.platform === "darwin"
      ? ["-q", "/dev/null", "/bin/sh", "-c", inner]
      : ["-q", "-f", "-e", "-c", inner, "/dev/null"];
  return { file: "script", args, env, detached: true, windowsVerbatimArguments: false };
}

/**
 * Whether this machine can run pseudo-terminals through `script`: util-linux's on Linux (BusyBox
 * and others take different flags), the system one on macOS, never on Windows.
 */
export async function detectTerminalMode(platform: NodeJS.Platform): Promise<TerminalMode> {
  if (platform === "darwin") return fs.existsSync("/usr/bin/script") ? "pty" : "pipes";
  if (platform !== "linux") return "pipes";
  const outcome = await runProcess("script", ["-V"], { timeoutMs: 3_000 });
  return outcome.exitCode === 0 && outcome.combined.includes("util-linux") ? "pty" : "pipes";
}

export type SpawnerOptions = {
  platform?: NodeJS.Platform;
  mode: TerminalMode;
  /** Studio's own environment, which every command inherits. */
  baseEnv?: NodeJS.ProcessEnv;
};

/** Starts terminal commands on this machine. */
export function createTerminalSpawner(options: SpawnerOptions): TerminalSpawner {
  const platform = options.platform ?? process.platform;
  const baseEnv = options.baseEnv ?? process.env;
  const mode: TerminalMode = platform === "win32" ? "pipes" : options.mode;
  const context: PlanContext = {
    platform,
    mode,
    shell: baseEnv.SHELL || "/bin/sh",
    comSpec: baseEnv.ComSpec ?? "cmd.exe",
  };
  return {
    mode,
    spawn: async (request) => {
      const plan = planTerminal(request, context);
      const child = spawn(plan.file, plan.args, {
        cwd: request.cwd,
        env: { ...baseEnv, ...plan.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: plan.detached,
        windowsHide: true,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      return wrapChild(child, platform, mode);
    },
  };
}

function wrapChild(child: ChildProcess, platform: NodeJS.Platform, mode: TerminalMode) {
  const pid = child.pid ?? null;
  const exitListeners: ((exitCode: number | null) => void)[] = [];
  let exited = false;
  let exitCode: number | null = null;
  let drain: NodeJS.Timeout | undefined;
  const finish = () => {
    if (exited) return;
    exited = true;
    clearTimeout(drain);
    for (const listener of exitListeners) listener(exitCode);
  };
  child.on("exit", (code) => {
    exitCode = code;
    drain = setTimeout(finish, DRAIN_AFTER_EXIT_MS);
  });
  child.on("close", (code) => {
    exitCode = code ?? exitCode;
    finish();
  });
  child.on("error", () => {});
  child.stdin?.on("error", () => {});

  const signalGroup = (signal: NodeJS.Signals) => {
    if (pid === null || exited) return;
    stopProcessTree(pid, platform, () => {
      try {
        process.kill(-pid, signal);
      } catch {
        child.kill(signal);
      }
    });
  };

  const terminal: TerminalProcess = {
    pid,
    write: (text) => {
      if (exited || !child.stdin?.writable) return;
      // A pseudo-terminal turns Enter's carriage return into a newline itself; pipes need it done.
      const data =
        mode === "pty" ? text : text.replace(/\r\n?/g, platform === "win32" ? "\r\n" : "\n");
      child.stdin.write(data);
    },
    interrupt: () => {
      if (mode === "pty") terminal.write("\u0003");
      else signalGroup("SIGINT");
    },
    terminate: () => signalGroup("SIGTERM"),
    kill: () => signalGroup("SIGKILL"),
    onData: (listener) => {
      for (const stream of [child.stdout, child.stderr]) {
        stream?.setEncoding("utf8");
        stream?.on("data", (text: string) => listener(text));
      }
    },
    onExit: (listener) => {
      if (exited) listener(exitCode);
      else exitListeners.push(listener);
    },
  };
  return terminal;
}

/** The local file system, with paths compared case-insensitively on Windows. */
export function nodeTerminalFolders(platform: NodeJS.Platform = process.platform): TerminalFolders {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const fold = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  return {
    directory: (dir) => {
      const resolved = paths.resolve(dir);
      try {
        return fs.statSync(resolved).isDirectory() ? resolved : null;
      } catch {
        return null;
      }
    },
    contains: (parent, child) => {
      const relative = paths.relative(fold(paths.resolve(parent)), fold(paths.resolve(child)));
      return relative === "" || (!relative.startsWith("..") && !paths.isAbsolute(relative));
    },
  };
}

/** Single quotes for sh, with any single quote inside closed, escaped and reopened. */
function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
