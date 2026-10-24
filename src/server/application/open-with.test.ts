import type { CustomApp } from "../../core/projects/custom-app.ts";
import { ok } from "../../core/result.ts";
import {
  type AppLauncher,
  type CustomAppStore,
  type InstalledApp,
  type LaunchCommand,
  OpenWith,
} from "./open-with.ts";

const VSCODE: InstalledApp = {
  id: "vscode",
  name: "VS Code",
  kind: "editor",
  command: { file: "/usr/bin/code", args: ["{path}"] },
};
const FILES: InstalledApp = {
  id: "file-manager",
  name: "File manager",
  kind: "file-manager",
  command: { file: "/usr/bin/xdg-open", args: ["{path}"] },
};

function setup(custom: CustomApp[] = []) {
  const launched: LaunchCommand[] = [];
  const launcher: AppLauncher = {
    launch: async (command) => {
      launched.push(command);
      return ok(undefined);
    },
  };
  const store: CustomAppStore & { apps: CustomApp[] } = {
    path: "/cfg/open-with.json",
    apps: custom,
    read: async () => store.apps,
    write: async (apps) => {
      store.apps = apps;
    },
  };
  const openWith = new OpenWith({
    catalog: { installed: async () => [VSCODE, FILES] },
    launcher,
    customApps: store,
    openableFolders: async () => new Set(["/home/dev/acme", "/home/dev/my app"]),
  });
  return { openWith, launched, store };
}

describe("OpenWith", () => {
  it("lists the apps found on the machine, then the custom ones", async () => {
    const { openWith } = setup([{ name: "Neovim", command: "kitty nvim {path}" }]);
    expect(await openWith.apps()).toEqual([
      { id: "vscode", name: "VS Code", kind: "editor" },
      { id: "file-manager", name: "File manager", kind: "file-manager" },
      { id: "custom-1", name: "Neovim", kind: "custom" },
    ]);
  });

  it("opens a known folder with an app found on the machine", async () => {
    const { openWith, launched } = setup();
    expect(await openWith.open({ appId: "vscode", path: "/home/dev/my app" })).toEqual(
      ok(undefined),
    );
    expect(launched).toEqual([{ file: "/usr/bin/code", args: ["/home/dev/my app"] }]);
  });

  it("opens a custom app with its command split into arguments, without a shell", async () => {
    const { openWith, launched } = setup([
      { name: "Neovim", command: `kitty --title "dev box" --directory {path} nvim` },
    ]);
    await openWith.open({ appId: "custom-1", path: "/home/dev/my app" });
    expect(launched).toEqual([
      {
        file: "kitty",
        args: ["--title", "dev box", "--directory", "/home/dev/my app", "nvim"],
      },
    ]);
  });

  it("refuses a folder Studio does not show", async () => {
    const { openWith, launched } = setup();
    for (const path of ["/etc", "/home/dev/acme/../..", "/home/dev/acme/", ""]) {
      const result = await openWith.open({ appId: "vscode", path });
      expect(result.ok ? null : result.error.code).toBe("path_not_allowed");
    }
    expect(launched).toEqual([]);
  });

  it("refuses an app it does not know, and a request without the fields", async () => {
    const { openWith, launched } = setup();
    const unknown = await openWith.open({ appId: "custom-9", path: "/home/dev/acme" });
    expect(unknown.ok ? null : unknown.error.code).toBe("unknown_app");
    const invalid = await openWith.open({ appId: 3 });
    expect(invalid.ok ? null : invalid.error.code).toBe("invalid_request");
    expect(launched).toEqual([]);
  });

  it("reads and replaces the custom apps, rejecting a list that does not parse", async () => {
    const { openWith, store } = setup();
    expect(await openWith.readCustomApps()).toEqual({ apps: [], path: "/cfg/open-with.json" });
    const saved = await openWith.updateCustomApps({
      apps: [{ name: " Helix ", command: "foot hx {path}" }],
    });
    expect(saved).toEqual(
      ok({ apps: [{ name: "Helix", command: "foot hx {path}" }], path: "/cfg/open-with.json" }),
    );
    const rejected = await openWith.updateCustomApps({ apps: [{ name: "x", command: `"` }] });
    expect(rejected.ok ? null : rejected.error).toEqual({
      code: "invalid_request",
      message: "x: A quote in the command is not closed.",
    });
    expect(store.apps).toEqual([{ name: "Helix", command: "foot hx {path}" }]);
  });
});
