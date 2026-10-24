import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { err, ok } from "../core/result.ts";
import type { Route } from "../core/routes/route.ts";
import type { AutoNamedEntry } from "../server/application/auto-named-store.ts";
import type { ProcessOwner } from "../server/application/process-control.ts";
import type { PortlessState, RouteRegistry } from "../server/application/route-registry.ts";
import type { Prompter } from "./prompter.ts";
import { removeStudioFiles, runUninstall, type UninstallDeps } from "./uninstall.ts";

function alias(name: string, port: number, kind: Route["kind"] = "alias"): Route {
  return {
    hostname: `${name}.localhost`,
    name,
    port,
    kind,
    pid: null,
    registeredAt: null,
    url: `http://${name}.localhost:1355`,
    tunnels: [],
  };
}

/** Answers yes/no questions in order and records them. */
function answering(...answers: boolean[]): Prompter & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    confirm: async (question) => {
      asked.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`Unexpected question: ${question}`);
      return answer;
    },
    ask: async () => {
      throw new Error("uninstall asks only yes/no questions");
    },
    suspend: (task) => task(),
    close: () => {},
  };
}

type FakeOptions = {
  routes?: Route[];
  autoNamed?: AutoNamedEntry[];
  serviceInstalled?: boolean;
  proxyRunning?: boolean;
  proxyPid?: number | null;
  recordedPid?: number | null;
  owner?: ProcessOwner;
  answers?: boolean[];
  configExists?: boolean;
};

function fake(options: FakeOptions = {}) {
  const calls: string[] = [];
  let routes = options.routes ?? [];
  let autoNamed = options.autoNamed ?? [];
  const registry: RouteRegistry = {
    readSnapshot: async (): Promise<PortlessState> => ({
      proxy: {
        running: options.proxyRunning ?? true,
        port: 1355,
        https: false,
        tlds: ["localhost"],
      },
      portless: { installed: true, version: "1.0.0" },
      routes,
      readAt: 0,
    }),
    watch: () => () => {},
    createAlias: async () => ok(undefined),
    removeAlias: async (name) => {
      calls.push(`remove ${name}`);
      routes = routes.filter((route) => route.name !== name);
      return ok(undefined);
    },
    installPortless: async () => ok({ version: null, output: "" }),
    startProxy: async () => ok(undefined),
    stopProxy: async () => {
      calls.push("stop proxy");
      return ok(undefined);
    },
    proxyPid: async () => (options.proxyPid === undefined ? 4242 : options.proxyPid),
  };
  const prompter = answering(...(options.answers ?? [true, false]));
  const lines: string[] = [];
  const recordedPid = options.recordedPid === undefined ? 4242 : options.recordedPid;
  const deps: UninstallDeps = {
    registry,
    autoNamed: {
      read: async () => autoNamed,
      write: async (entries) => {
        calls.push(`write auto-named ${entries.length}`);
        autoNamed = entries;
      },
    },
    prompter,
    print: (line) => lines.push(line),
    homeDir: "/home/dev",
    configDir: "/home/dev/.portless-studio",
    configExists: options.configExists ?? true,
    service: {
      status: async () => ({
        file: "/home/dev/.config/systemd/user/portless-studio.service",
        installed: options.serviceInstalled ?? true,
        running: true,
      }),
      uninstall: async () => {
        calls.push("remove service");
        return ok({
          file: "/home/dev/.config/systemd/user/portless-studio.service",
          removed: true,
        });
      },
    },
    proxyRecord: recordedPid === null ? null : { pid: recordedPid },
    forgetProxyRecord: () => calls.push("forget proxy record"),
    ownerOf: async () => options.owner ?? "you",
    removeConfig: async () => {
      calls.push("delete config");
      return ok(undefined);
    },
  };
  return { deps, calls, lines, prompter, routes: () => routes };
}

const output = (lines: string[]) => lines.join("\n");

describe("runUninstall", () => {
  it("lists every step, asks once, undoes them all and prints a summary", async () => {
    const { deps, calls, lines, prompter, routes } = fake({
      routes: [alias("app.acme", 5173), alias("studio", 4949), alias("db", 5432)],
      autoNamed: [{ name: "app.acme", port: 5173, createdAt: 0 }],
    });

    const summary = await runUninstall(deps);

    const text = output(lines);
    expect(text).toContain("Stop and remove the login service");
    expect(text).toContain("app.acme");
    expect(text).toContain('Remove the "studio" name');
    expect(text).toContain("Stop the portless proxy Studio started (pid 4242)");
    expect(prompter.asked).toHaveLength(2);
    expect(calls).toEqual([
      "remove service",
      "remove app.acme",
      "remove studio",
      "write auto-named 0",
      "stop proxy",
      "forget proxy record",
    ]);
    expect(routes().map((route) => route.name)).toEqual(["db"]);
    expect(summary).toEqual({
      service: "removed",
      namesRemoved: ["app.acme", "studio"],
      proxy: "stopped",
      config: "kept",
    });
    expect(text).toContain("Names removed");
  });

  it("never removes a name a person or an agent gave, even one auto mode gave before", async () => {
    const { deps, calls } = fake({
      // `web.acme` was auto-named on 3000 but now points at 3001: someone renamed it.
      routes: [alias("web.acme", 3001), alias("api", 8080)],
      autoNamed: [{ name: "web.acme", port: 3000, createdAt: 0 }],
    });
    await runUninstall(deps);
    expect(calls).not.toContain("remove web.acme");
    expect(calls).not.toContain("remove api");
  });

  it("leaves a proxy it did not start, or one another user runs", async () => {
    const byHand = fake({ recordedPid: null });
    expect((await runUninstall(byHand.deps)).proxy).toBe("not-ours");
    expect(byHand.calls).not.toContain("stop proxy");

    const restarted = fake({ recordedPid: 1, proxyPid: 2 });
    expect((await runUninstall(restarted.deps)).proxy).toBe("not-ours");

    const asRoot = fake({ owner: "root" });
    expect((await runUninstall(asRoot.deps)).proxy).toBe("other-user");
    expect(asRoot.calls).not.toContain("stop proxy");
    expect(output(asRoot.lines)).toContain("sudo");
  });

  it("asks separately before deleting the settings, and deletes them on yes", async () => {
    const { deps, calls, prompter } = fake({ answers: [true, true] });
    const summary = await runUninstall(deps);
    expect(prompter.asked[1]).toMatch(/delete.*settings/i);
    expect(calls).toContain("delete config");
    expect(summary.config).toBe("deleted");
  });

  it("changes nothing when the person says no", async () => {
    const { deps, calls, lines } = fake({ answers: [false] });
    const summary = await runUninstall(deps);
    expect(calls).toEqual([]);
    expect(output(lines)).toContain("Nothing changed");
    expect(summary).toEqual({ service: "kept", namesRemoved: [], proxy: "kept", config: "kept" });
  });

  it("still offers to delete the settings when nothing else is left to undo", async () => {
    const { deps, prompter, lines } = fake({
      serviceInstalled: false,
      proxyRunning: false,
      answers: [false],
    });
    const summary = await runUninstall(deps);
    expect(output(lines)).toContain("Nothing else to undo");
    expect(prompter.asked).toHaveLength(1);
    expect(summary).toMatchObject({ service: "not-installed", proxy: "not-running" });
  });

  it("reports a step that fails and keeps going", async () => {
    const { deps, calls, lines } = fake({ routes: [alias("studio", 4949)] });
    deps.service.uninstall = async () => err("systemctl is missing");
    const summary = await runUninstall(deps);
    expect(summary.service).toBe("failed");
    expect(output(lines)).toContain("systemctl is missing");
    expect(calls).toContain("remove studio");
  });
});

describe("removeStudioFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes Studio's files and the folder once it is empty", () => {
    const folder = path.join(dir, ".portless-studio");
    fs.mkdirSync(folder);
    for (const file of ["config.json", "auto-named.json"]) {
      fs.writeFileSync(path.join(folder, file), "{}");
    }
    expect(
      removeStudioFiles(folder, ["config.json", "auto-named.json", "proxy-started.json"]),
    ).toEqual({ ok: true, value: undefined });
    expect(fs.existsSync(folder)).toBe(false);
  });

  it("keeps the folder and any file Studio did not write", () => {
    const folder = path.join(dir, "shared");
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "config.json"), "{}");
    fs.writeFileSync(path.join(folder, "notes.txt"), "mine");
    removeStudioFiles(folder, ["config.json"]);
    expect(fs.readdirSync(folder)).toEqual(["notes.txt"]);
  });
});
