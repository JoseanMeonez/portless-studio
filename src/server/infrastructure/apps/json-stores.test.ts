import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  JsonCustomAppStore,
  JsonRouteProjectStore,
  openWithPathFor,
  routeProjectsPathFor,
} from "./json-stores.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const config = path.join("/cfg", "portless-studio", "config.json");

describe("JsonRouteProjectStore", () => {
  it("lives next to the config file", () => {
    expect(routeProjectsPathFor(config)).toBe(
      path.join("/cfg", "portless-studio", "route-projects.json"),
    );
  });

  it("writes the projects and reads them back, skipping malformed entries", async () => {
    const file = path.join(dir, "nested", "route-projects.json");
    const store = new JsonRouteProjectStore(file);
    expect(await store.read()).toEqual({});
    const web = { name: "acme", worktree: "falcon", branch: "main", path: "/home/dev/acme" };
    await store.write({ web });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ routeProjects: { web } });

    fs.writeFileSync(file, JSON.stringify({ routeProjects: { web, bad: { name: 3 }, nil: null } }));
    expect(await store.read()).toEqual({ web });
    fs.writeFileSync(file, "{ nope");
    expect(await store.read()).toEqual({});
  });
});

describe("JsonCustomAppStore", () => {
  it("lives next to the config file", () => {
    expect(openWithPathFor(config)).toBe(path.join("/cfg", "portless-studio", "open-with.json"));
  });

  it("writes the apps and reads them back, skipping malformed entries", async () => {
    const file = path.join(dir, "open-with.json");
    const store = new JsonCustomAppStore(file);
    expect(await store.read()).toEqual([]);
    const app = { name: "Neovim", command: "kitty nvim {path}" };
    await store.write([app]);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ customApps: [app] });

    fs.writeFileSync(file, JSON.stringify({ customApps: [app, { name: "x" }, 4] }));
    expect(await store.read()).toEqual([app]);
  });
});
