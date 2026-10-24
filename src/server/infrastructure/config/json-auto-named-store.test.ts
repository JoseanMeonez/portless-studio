import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { autoNamedPathFor, JsonAutoNamedStore } from "./json-auto-named-store.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("JsonAutoNamedStore", () => {
  it("lives next to the config file", () => {
    expect(autoNamedPathFor(path.join("/cfg", "portless-studio", "config.json"))).toBe(
      path.join("/cfg", "portless-studio", "auto-named.json"),
    );
  });

  it("reads an empty list when the file is missing or broken", async () => {
    const file = path.join(dir, "auto-named.json");
    expect(await new JsonAutoNamedStore(file).read()).toEqual([]);
    fs.writeFileSync(file, "{ nope");
    expect(await new JsonAutoNamedStore(file).read()).toEqual([]);
  });

  it("writes the list and reads it back, skipping malformed entries", async () => {
    const file = path.join(dir, "nested", "auto-named.json");
    const store = new JsonAutoNamedStore(file);
    await store.write([{ name: "app.acme", port: 5173, createdAt: 10 }]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
      autoNamed: [{ name: "app.acme", port: 5173, createdAt: 10 }],
    });
    fs.writeFileSync(
      file,
      JSON.stringify({ autoNamed: [{ name: "ok", port: 1, createdAt: 2 }, { name: 3 }, null] }),
    );
    expect(await store.read()).toEqual([{ name: "ok", port: 1, createdAt: 2 }]);
  });
});
