import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG, type StudioConfig } from "../core/config/studio-config.ts";
import { ok } from "../core/result.ts";
import type { ConfigStore } from "../server/application/config-store.ts";
import type { CommandRunner } from "./command-runner.ts";
import { editConfig, printConfig, printConfigJson } from "./config-command.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function store(file: string): ConfigStore & { writes: StudioConfig[] } {
  const writes: StudioConfig[] = [];
  return {
    writes,
    path: file,
    read: async () => ok({ ...DEFAULT_CONFIG, port: 5050 }),
    write: async (config) => {
      writes.push(config);
      fs.writeFileSync(file, JSON.stringify(config));
      return ok(undefined);
    },
    watch: () => () => {},
  };
}

describe("printConfigJson", () => {
  it("prints only the config and its path as one JSON document", async () => {
    const lines: string[] = [];
    const file = path.join(dir, "config.json");
    expect(await printConfigJson(store(file), (line) => lines.push(line))).toBe(0);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      config: { ...DEFAULT_CONFIG, port: 5050 },
      path: file,
    });
  });
});

describe("printConfig", () => {
  it("prints the path and the current config as JSON", async () => {
    const lines: string[] = [];
    await printConfig(store(path.join(dir, "config.json")), (line) => lines.push(line));
    expect(lines[0]).toBe(`Config file: ${path.join(dir, "config.json")}`);
    expect(JSON.parse(lines[1] ?? "")).toEqual({ ...DEFAULT_CONFIG, port: 5050 });
    expect(lines[2]).toContain("not created yet");
  });
});

describe("editConfig", () => {
  it("creates the file and opens it in $EDITOR", async () => {
    const file = path.join(dir, "config.json");
    const s = store(file);
    const commands: string[] = [];
    const run: CommandRunner = async (command, args, options) => {
      commands.push(`${command} ${args.join(" ")} ${options?.inherit ? "[inherit]" : ""}`);
      return { exitCode: 0, output: "", missing: false };
    };
    await editConfig(s, "code -w", run, () => {});
    expect(s.writes).toHaveLength(1);
    expect(commands).toEqual([`code -w ${file} [inherit]`]);
  });

  it("prints the path when there is no editor", async () => {
    const file = path.join(dir, "config.json");
    fs.writeFileSync(file, "{}");
    const lines: string[] = [];
    const run: CommandRunner = async () => {
      throw new Error("must not run");
    };
    await editConfig(store(file), undefined, run, (line) => lines.push(line));
    expect(lines.join("\n")).toContain(file);
  });
});
