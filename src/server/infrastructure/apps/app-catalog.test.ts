import { createAppCatalog } from "./app-catalog.ts";

function catalog(
  platform: NodeJS.Platform,
  env: Record<string, string>,
  files: string[],
  homeDir = "/home/dev",
) {
  const present = new Set(files);
  return createAppCatalog({ platform, env, homeDir, exists: (file) => present.has(file) });
}

describe("createAppCatalog", () => {
  it("finds editors and the file manager on PATH on Linux", async () => {
    const apps = await catalog("linux", { PATH: "/usr/bin:/home/dev/.local/bin" }, [
      "/usr/bin/code",
      "/home/dev/.local/bin/zed",
      "/usr/bin/subl",
      "/usr/bin/xdg-open",
    ]).installed();
    expect(apps).toEqual([
      {
        id: "vscode",
        name: "VS Code",
        kind: "editor",
        command: { file: "/usr/bin/code", args: ["{path}"] },
      },
      {
        id: "zed",
        name: "Zed",
        kind: "editor",
        command: { file: "/home/dev/.local/bin/zed", args: ["{path}"] },
      },
      {
        id: "sublime",
        name: "Sublime Text",
        kind: "editor",
        command: { file: "/usr/bin/subl", args: ["{path}"] },
      },
      {
        id: "file-manager",
        name: "File manager",
        kind: "file-manager",
        command: { file: "/usr/bin/xdg-open", args: ["{path}"] },
      },
    ]);
  });

  it("finds nothing on Linux without the commands", async () => {
    expect(await catalog("linux", { PATH: "/usr/bin" }, []).installed()).toEqual([]);
  });

  it("uses the command on PATH or the app bundle with open -a on macOS", async () => {
    const apps = await catalog(
      "darwin",
      { PATH: "/usr/local/bin:/usr/bin" },
      [
        "/usr/local/bin/cursor",
        "/Applications/Visual Studio Code.app",
        "/Users/dev/Applications/Zed.app",
        "/Applications/WebStorm.app",
      ],
      "/Users/dev",
    ).installed();
    expect(apps.map((app) => [app.id, app.command])).toEqual([
      ["vscode", { file: "open", args: ["-a", "/Applications/Visual Studio Code.app", "{path}"] }],
      ["cursor", { file: "/usr/local/bin/cursor", args: ["{path}"] }],
      ["zed", { file: "open", args: ["-a", "/Users/dev/Applications/Zed.app", "{path}"] }],
      ["webstorm", { file: "open", args: ["-a", "/Applications/WebStorm.app", "{path}"] }],
      ["file-manager", { file: "open", args: ["-R", "{path}"] }],
    ]);
    expect(apps.at(-1)?.name).toBe("Finder");
  });

  it("uses well-known install folders and PATH shims on Windows", async () => {
    const apps = await catalog(
      "win32",
      {
        Path: "C:\\bin;C:\\tools",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
        ProgramFiles: "C:\\Program Files",
      },
      [
        "C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
        "C:\\tools\\cursor.cmd",
        "C:\\Program Files\\Sublime Text\\subl.exe",
      ],
      "C:\\Users\\dev",
    ).installed();
    expect(apps.map((app) => [app.id, app.command])).toEqual([
      [
        "vscode",
        {
          file: "C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
          args: ["{path}"],
        },
      ],
      ["cursor", { file: "C:\\tools\\cursor.cmd", args: ["{path}"] }],
      ["sublime", { file: "C:\\Program Files\\Sublime Text\\subl.exe", args: ["{path}"] }],
      ["file-manager", { file: "explorer.exe", args: ['/select,"{path}"'], windowsVerbatim: true }],
    ]);
    expect(apps.at(-1)?.name).toBe("File Explorer");
  });
});
