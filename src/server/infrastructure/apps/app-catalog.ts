import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AppCatalog, InstalledApp, LaunchCommand } from "../../application/open-with.ts";

/** What detection reads from the machine; tests pass a fake file system and environment. */
export type AppCatalogEnvironment = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeDir: string;
  exists(file: string): boolean;
};

type Editor = {
  id: string;
  name: string;
  /** Commands the editor installs on PATH, in order of preference. */
  commands: string[];
  /** App bundle names in `/Applications` or `~/Applications`. */
  macApps: string[];
  /** Install folders on Windows, as [base env variable, path below it]. */
  windowsPaths: Array<[string, string]>;
};

const EDITORS: Editor[] = [
  {
    id: "vscode",
    name: "VS Code",
    commands: ["code"],
    macApps: ["Visual Studio Code.app"],
    windowsPaths: [
      ["LOCALAPPDATA", "Programs\\Microsoft VS Code\\Code.exe"],
      ["ProgramFiles", "Microsoft VS Code\\Code.exe"],
    ],
  },
  {
    id: "vscode-insiders",
    name: "VS Code Insiders",
    commands: ["code-insiders"],
    macApps: ["Visual Studio Code - Insiders.app"],
    windowsPaths: [["LOCALAPPDATA", "Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe"]],
  },
  {
    id: "cursor",
    name: "Cursor",
    commands: ["cursor"],
    macApps: ["Cursor.app"],
    windowsPaths: [["LOCALAPPDATA", "Programs\\cursor\\Cursor.exe"]],
  },
  {
    id: "zed",
    name: "Zed",
    commands: ["zed", "zeditor"],
    macApps: ["Zed.app"],
    windowsPaths: [["LOCALAPPDATA", "Programs\\Zed\\Zed.exe"]],
  },
  {
    id: "webstorm",
    name: "WebStorm",
    commands: ["webstorm"],
    macApps: ["WebStorm.app"],
    windowsPaths: [],
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    commands: ["idea"],
    macApps: ["IntelliJ IDEA.app", "IntelliJ IDEA CE.app"],
    windowsPaths: [],
  },
  {
    id: "sublime",
    name: "Sublime Text",
    commands: ["subl"],
    macApps: ["Sublime Text.app"],
    windowsPaths: [["ProgramFiles", "Sublime Text\\subl.exe"]],
  },
];

/**
 * Finds editors and the file manager without starting anything: commands on PATH on every
 * system, app bundles opened with `open -a` on macOS, and the usual install folders on Windows.
 */
export function createAppCatalog(environment: AppCatalogEnvironment): AppCatalog {
  return { installed: async () => installedApps(environment) };
}

export function systemAppCatalog(): AppCatalog {
  return createAppCatalog({
    platform: process.platform,
    env: process.env,
    homeDir: os.homedir(),
    exists: (file) => fs.existsSync(file),
  });
}

function installedApps(environment: AppCatalogEnvironment): InstalledApp[] {
  const apps: InstalledApp[] = [];
  for (const editor of EDITORS) {
    const command = editorCommand(editor, environment);
    if (command) apps.push({ id: editor.id, name: editor.name, kind: "editor", command });
  }
  const files = fileManager(environment);
  if (files) apps.push({ id: "file-manager", kind: "file-manager", ...files });
  return apps;
}

function editorCommand(editor: Editor, environment: AppCatalogEnvironment): LaunchCommand | null {
  const { platform, exists, homeDir } = environment;
  if (platform === "win32") {
    for (const [variable, below] of editor.windowsPaths) {
      const base = envValue(environment, variable);
      const file = base ? path.win32.join(base, below) : null;
      if (file && exists(file)) return { file, args: ["{path}"] };
    }
  }
  for (const name of editor.commands) {
    const file = onPath(name, environment);
    if (file) return { file, args: ["{path}"] };
  }
  if (platform === "darwin") {
    for (const folder of ["/Applications", path.posix.join(homeDir, "Applications")]) {
      for (const bundle of editor.macApps) {
        const app = path.posix.join(folder, bundle);
        if (exists(app)) return { file: "open", args: ["-a", app, "{path}"] };
      }
    }
  }
  return null;
}

function fileManager(
  environment: AppCatalogEnvironment,
): { name: string; command: LaunchCommand } | null {
  if (environment.platform === "darwin") {
    return { name: "Finder", command: { file: "open", args: ["-R", "{path}"] } };
  }
  if (environment.platform === "win32") {
    // explorer reads its own command line; `/select,"<path>"` must reach it as written.
    return {
      name: "File Explorer",
      command: { file: "explorer.exe", args: ['/select,"{path}"'], windowsVerbatim: true },
    };
  }
  const file = onPath("xdg-open", environment);
  return file ? { name: "File manager", command: { file, args: ["{path}"] } } : null;
}

/** Full path of `name` on PATH, trying PATHEXT extensions on Windows; null when absent. */
function onPath(name: string, environment: AppCatalogEnvironment): string | null {
  const windows = environment.platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const folders = (envValue(environment, "PATH") ?? "").split(windows ? ";" : ":");
  const extensions = windows
    ? (envValue(environment, "PATHEXT") ?? ".EXE;.CMD;.BAT")
        .split(";")
        .filter((extension) => extension !== "")
        .map((extension) => extension.toLowerCase())
    : [""];
  for (const folder of folders) {
    if (folder === "") continue;
    for (const extension of extensions) {
      const file = paths.join(folder, `${name}${extension}`);
      if (environment.exists(file)) return file;
    }
  }
  return null;
}

/** Windows environment names ignore case (`Path`, `PATH`); elsewhere they are exact. */
function envValue(environment: AppCatalogEnvironment, name: string): string | undefined {
  if (environment.platform !== "win32") return environment.env[name];
  const key = Object.keys(environment.env).find(
    (item) => item.toLowerCase() === name.toLowerCase(),
  );
  return key === undefined ? undefined : environment.env[key];
}
