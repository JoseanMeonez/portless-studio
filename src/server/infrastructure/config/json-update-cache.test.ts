import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JsonUpdateCache, updateCheckPathFor } from "./json-update-cache.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("JsonUpdateCache", () => {
  it("sits next to the config file", () => {
    expect(updateCheckPathFor(path.join(dir, "config.json"))).toBe(
      path.join(dir, "update-check.json"),
    );
  });

  it("reads back what it wrote", () => {
    const cache = new JsonUpdateCache(path.join(dir, "update-check.json"));
    expect(cache.read()).toBeNull();
    cache.write({ checkedAt: 1000, latest: "0.2.0" });
    expect(cache.read()).toEqual({ checkedAt: 1000, latest: "0.2.0" });
    cache.write({ checkedAt: 2000, latest: null });
    expect(cache.read()).toEqual({ checkedAt: 2000, latest: null });
  });

  it("ignores a file it cannot read", () => {
    const file = path.join(dir, "update-check.json");
    fs.writeFileSync(file, '{"checkedAt":"yesterday"}');
    expect(new JsonUpdateCache(file).read()).toBeNull();
    fs.writeFileSync(file, "not json");
    expect(new JsonUpdateCache(file).read()).toBeNull();
  });
});
