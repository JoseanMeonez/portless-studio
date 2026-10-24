import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG } from "../../../core/config/studio-config.ts";
import { defaultConfigPath, JsonConfigStore } from "./json-config-store.ts";

let dir: string;
let file: string;
const stops: (() => void)[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
  file = path.join(dir, "nested", "config.json");
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("defaultConfigPath", () => {
  it("uses PORTLESS_STUDIO_CONFIG first", () => {
    expect(defaultConfigPath({ PORTLESS_STUDIO_CONFIG: "/x/c.json" }, "linux", "/home/ana")).toBe(
      "/x/c.json",
    );
  });

  it("uses APPDATA on Windows", () => {
    expect(
      defaultConfigPath({ APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "win32", "C:\\"),
    ).toBe(path.join("C:\\Users\\ana\\AppData\\Roaming", "portless-studio", "config.json"));
  });

  it("uses XDG_CONFIG_HOME, else ~/.config, elsewhere", () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/cfg" }, "linux", "/home/ana")).toBe(
      path.join("/cfg", "portless-studio", "config.json"),
    );
    expect(defaultConfigPath({}, "darwin", "/Users/ana")).toBe(
      path.join("/Users/ana", ".config", "portless-studio", "config.json"),
    );
  });
});

describe("JsonConfigStore", () => {
  it("returns the defaults when the file does not exist", async () => {
    const store = new JsonConfigStore(file);
    expect(store.path).toBe(file);
    expect(await store.read()).toEqual({ ok: true, value: DEFAULT_CONFIG });
  });

  it("fails with invalid_config on broken JSON", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ nope");
    const result = await new JsonConfigStore(file).read();
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_config" } });
  });

  it("fails with invalid_config and the field name when a value is wrong", async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ autoName: "yes" }));
    const result = await new JsonConfigStore(file).read();
    expect(result).toEqual({
      ok: false,
      error: { code: "invalid_config", message: `"autoName" must be true or false.` },
    });
  });

  it("writes pretty JSON with a trailing newline and reads it back", async () => {
    const store = new JsonConfigStore(file);
    const config = { ...DEFAULT_CONFIG, autoName: true, ignoredPorts: [3000] };
    expect(await store.write(config)).toEqual({ ok: true, value: undefined });
    const text = fs.readFileSync(file, "utf8");
    expect(text).toBe(`${JSON.stringify(config, null, 2)}\n`);
    expect(await store.read()).toEqual({ ok: true, value: config });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["config.json"]);
  });

  it("calls watchers when the content changes, not when it is rewritten the same", async () => {
    const store = new JsonConfigStore(file, { debounceMs: 20, pollMs: 50 });
    let calls = 0;
    stops.push(store.watch(() => calls++));

    await store.write({ ...DEFAULT_CONFIG, autoName: true });
    await vi.waitFor(() => expect(calls).toBe(1));

    await store.write({ ...DEFAULT_CONFIG, autoName: true });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(1);

    fs.writeFileSync(file, JSON.stringify({ scanIntervalMs: 5000 }));
    await vi.waitFor(() => expect(calls).toBe(2));
  });
});
