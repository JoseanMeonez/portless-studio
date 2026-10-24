import type { Snapshot } from "../core/api/contract.ts";
import { DEFAULT_CONFIG, type StudioConfig } from "../core/config/studio-config.ts";
import type { DetectedPort } from "../core/ports/detected-port.ts";
import { err, ok } from "../core/result.ts";
import type { CommandRunner } from "./command-runner.ts";
import { type InitDeps, type InitServices, runInit } from "./init.ts";
import { createDefaultsPrompter, type Prompter } from "./prompter.ts";

type Answer = [question: string, answer: boolean | string];

/** Answers each question in order and fails the test when a question is not the expected one. */
function scripted(answers: Answer[]): Prompter & { asked: string[]; events: string[] } {
  const queue = [...answers];
  const asked: string[] = [];
  const events: string[] = [];
  const next = (question: string) => {
    asked.push(question);
    const entry = queue.shift();
    if (!entry) throw new Error(`Unexpected question: ${question}`);
    expect(question.toLowerCase()).toContain(entry[0].toLowerCase());
    return entry[1];
  };
  return {
    asked,
    events,
    suspend: async (task) => {
      events.push("suspend");
      const result = await task();
      events.push("resume");
      return result;
    },
    confirm: async (question) => {
      const answer = next(question);
      if (typeof answer !== "boolean") throw new Error(`Expected yes/no for: ${question}`);
      return answer;
    },
    ask: async (question) => {
      const answer = next(question);
      if (typeof answer !== "string") throw new Error(`Expected text for: ${question}`);
      return answer;
    },
    close: () => {},
  };
}

function detected(port: number, suggestedName: string | null): DetectedPort {
  return {
    port,
    pid: port,
    processName: "node",
    cwd: `/home/dev/code/app-${port}`,
    suggestedName,
  };
}

type FakeOptions = {
  installed?: boolean;
  installFails?: boolean;
  proxyRunning?: boolean;
  ports?: DetectedPort[];
  /** Names that already exist, so creating them fails with name_taken. */
  taken?: string[];
};

function fakeServices(options: FakeOptions = {}) {
  let installed = options.installed ?? true;
  let saved: StudioConfig | null = null;
  const calls: string[] = [];
  const taken = new Set(options.taken ?? []);
  const snapshot = (): Snapshot => ({
    proxy: { running: options.proxyRunning ?? false, port: 443, https: true, tlds: ["localhost"] },
    portless: { installed, version: installed ? "0.15.11" : null },
    routes: [],
    detected: [],
    autoName: false,
    readAt: 0,
  });
  const services: InitServices = {
    registry: {
      readSnapshot: async () => snapshot(),
      watch: () => () => {},
      createAlias: async (name, port, force) => {
        calls.push(`alias ${name} ${port} ${force}`);
        if (taken.has(name)) return err({ code: "name_taken", message: `${name} is taken` });
        taken.add(name);
        return ok(undefined);
      },
      removeAlias: async () => ok(undefined),
      installPortless: async () => {
        calls.push("install portless");
        if (options.installFails) return err({ code: "install_failed", message: "npm exploded" });
        installed = true;
        return ok({ version: "0.15.11", output: "" });
      },
    },
    configStore: {
      path: "/home/dev/.config/portless-studio/config.json",
      read: async () => ok(saved ?? DEFAULT_CONFIG),
      write: async (config) => {
        saved = config;
        return ok(undefined);
      },
      watch: () => () => {},
    },
    detectPorts: async () => options.ports ?? [],
  };
  return { services, calls, saved: () => saved };
}

function harness(
  fake: ReturnType<typeof fakeServices>,
  prompter: Prompter & { events?: string[] },
  exitCodes: number[] = [],
) {
  const lines: string[] = [];
  const commands: string[] = [];
  const run: CommandRunner = async (command, args, runOptions) => {
    commands.push(`${command} ${args.join(" ")}${runOptions?.inherit ? " [inherit]" : ""}`);
    prompter.events?.push("run");
    return { exitCode: exitCodes.shift() ?? 0, output: "", missing: false };
  };
  let serviceInstalls = 0;
  const deps: InitDeps = {
    services: fake.services,
    prompter,
    run,
    print: (line) => lines.push(line),
    portlessBin: "portless",
    homeDir: "/home/dev",
    installLoginService: async () => {
      serviceInstalls += 1;
      return ok("Studio will start when you log in.");
    },
  };
  return { deps, lines, commands, serviceInstalls: () => serviceInstalls };
}

describe("runInit with --yes", () => {
  it("installs portless, saves the defaults, names ports, starts the proxy and the service", async () => {
    const fake = fakeServices({
      installed: false,
      ports: [detected(5173, "app.acme"), detected(4321, "web.acme")],
    });
    const h = harness(
      fake,
      createDefaultsPrompter(() => {}),
    );

    const summary = await runInit(h.deps);

    expect(fake.calls).toEqual([
      "install portless",
      "alias app.acme 5173 false",
      "alias web.acme 4321 false",
    ]);
    expect(fake.saved()).toEqual({ ...DEFAULT_CONFIG, autoName: true, openBrowser: true });
    expect(h.commands).toEqual(["portless proxy start [inherit]"]);
    expect(h.serviceInstalls()).toBe(1);
    expect(summary).toEqual({
      configPath: "/home/dev/.config/portless-studio/config.json",
      namesCreated: 2,
      url: "https://studio.localhost",
    });
    expect(h.lines.join("\n")).toContain("~/code/app-5173");
  });
});

describe("runInit with answers", () => {
  it("saves what was answered, retries a taken name with the port and skips unnamed ports", async () => {
    const fake = fakeServices({
      proxyRunning: false,
      ports: [detected(5173, "app"), detected(9000, null)],
      taken: ["app"],
    });
    const prompter = scripted([
      ["auto mode", false],
      ["log in", false],
      ["port", "abc"],
      ["port", "5050"],
      ["open the browser", false],
      ["Name this port?", true],
      ["Start the portless proxy now?", false],
    ]);
    const h = harness(fake, prompter);

    const summary = await runInit(h.deps);

    expect(fake.saved()).toEqual({
      ...DEFAULT_CONFIG,
      autoName: false,
      port: 5050,
      openBrowser: false,
    });
    expect(fake.calls).toEqual(["alias app 5173 false", "alias app-5173 5173 false"]);
    expect(h.commands).toEqual([]);
    expect(h.serviceInstalls()).toBe(0);
    expect(summary.namesCreated).toBe(1);
    const output = h.lines.join("\n");
    expect(output).toContain("app-5173");
    expect(output).toContain("portless-studio");
    expect(output).toContain("443");
  });

  it("starts the proxy with the terminal attached only after a yes", async () => {
    const fake = fakeServices({ proxyRunning: false });
    const prompter = scripted([
      ["auto mode", true],
      ["log in", false],
      ["port", "4949"],
      ["open the browser", true],
      ["Start the portless proxy now?", true],
    ]);
    const h = harness(fake, prompter);

    await runInit(h.deps);

    expect(h.commands).toEqual(["portless proxy start [inherit]"]);
  });

  it("lets go of the terminal while the proxy asks for the password", async () => {
    const prompter = scripted([
      ["auto mode", true],
      ["log in", false],
      ["port", "4949"],
      ["open the browser", true],
      ["Start the portless proxy now?", true],
    ]);
    const h = harness(fakeServices({ proxyRunning: false }), prompter);

    await runInit(h.deps);

    expect(prompter.events).toEqual(["suspend", "run", "resume"]);
  });

  it("offers port 1355 without sudo when the start on 443 fails", async () => {
    const prompter = scripted([
      ["auto mode", true],
      ["log in", false],
      ["port", "4949"],
      ["open the browser", true],
      ["Start the portless proxy now?", true],
      ["port 1355", true],
    ]);
    const h = harness(fakeServices({ proxyRunning: false }), prompter, [1, 0]);

    await runInit(h.deps);

    expect(h.commands).toEqual([
      "portless proxy start [inherit]",
      "portless proxy start --port 1355 --https [inherit]",
    ]);
  });

  it("gives the plain URL when the proxy is not running", async () => {
    const prompter = scripted([
      ["auto mode", true],
      ["log in", false],
      ["port", "4949"],
      ["open the browser", true],
      ["Start the portless proxy now?", false],
    ]);
    const h = harness(fakeServices({ proxyRunning: false }), prompter);

    expect((await runInit(h.deps)).url).toBe("http://127.0.0.1:4949");
  });

  it("does not ask about the proxy when it already runs, and names nothing on a no", async () => {
    const fake = fakeServices({ proxyRunning: true, ports: [detected(5173, "app")] });
    const prompter = scripted([
      ["auto mode", true],
      ["log in", true],
      ["port", "4949"],
      ["open the browser", true],
      ["Name this port?", false],
    ]);
    const h = harness(fake, prompter);

    const summary = await runInit(h.deps);

    expect(fake.calls).toEqual([]);
    expect(h.commands).toEqual([]);
    expect(h.serviceInstalls()).toBe(1);
    expect(summary.namesCreated).toBe(0);
  });

  it("shows the manual command when the portless install fails and skips naming", async () => {
    const fake = fakeServices({
      installed: false,
      installFails: true,
      ports: [detected(5173, "app")],
    });
    const prompter = scripted([
      ["portless is not installed. Install it now with npm?", true],
      ["auto mode", false],
      ["log in", false],
      ["port", "4949"],
      ["open the browser", true],
    ]);
    const h = harness(fake, prompter);

    await runInit(h.deps);

    expect(fake.calls).toEqual(["install portless"]);
    expect(h.commands).toEqual([]);
    const output = h.lines.join("\n");
    expect(output).toContain("npm exploded");
    expect(output).toContain("npm install -g portless");
  });

  it("uses the plain URL when Studio does not register its name", async () => {
    const fake = fakeServices({ proxyRunning: true });
    await fake.services.configStore.write({ ...DEFAULT_CONFIG, registerStudioAlias: false });
    const prompter = scripted([
      ["auto mode", false],
      ["log in", false],
      ["port", "5050"],
      ["open the browser", false],
    ]);
    const h = harness(fake, prompter);

    expect((await runInit(h.deps)).url).toBe("http://127.0.0.1:5050");
  });
});
