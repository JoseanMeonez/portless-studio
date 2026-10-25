import { err, ok } from "../core/result.ts";
import { type EnvCommandOptions, runEnvCommand } from "./env-command.ts";

const ROUTES = [
  { name: "web.acme", url: "http://web.acme.localhost:1355", port: 5173 },
  { name: "api.acme", url: "http://api.acme.localhost:1355", port: 4000 },
  { name: "docs", url: "http://docs.localhost:1355", port: 3001 },
];

async function run(overrides: Partial<EnvCommandOptions> = {}, studioUp = true) {
  const out: string[] = [];
  const errors: string[] = [];
  let localReads = 0;
  const code = await runEnvCommand({
    json: false,
    direct: false,
    prefix: null,
    strip: null,
    names: [],
    print: (line) => out.push(line),
    printError: (line) => errors.push(line),
    readFromStudio: async () =>
      studioUp
        ? ok(ROUTES)
        : err({ kind: "not_running" as const, message: "Portless Studio is not running." }),
    readLocally: async () => {
      localReads += 1;
      return ROUTES;
    },
    ...overrides,
  });
  return { code, out, errors, localReads };
}

describe("runEnvCommand", () => {
  it("prints one KEY=url line per route on stdout, sorted by name", async () => {
    const { code, out, errors, localReads } = await run();
    expect(code).toBe(0);
    expect(localReads).toBe(0);
    expect(errors).toEqual([]);
    expect(out).toEqual([
      "API_ACME_URL=http://api.acme.localhost:1355\nDOCS_URL=http://docs.localhost:1355\nWEB_ACME_URL=http://web.acme.localhost:1355",
    ]);
  });

  it("keeps only the routes the names match and applies prefix, strip and direct", async () => {
    const { out } = await run({ names: ["acme"], prefix: "VITE_", strip: "acme", direct: true });
    expect(out).toEqual(["VITE_API_URL=http://localhost:4000\nVITE_WEB_URL=http://localhost:5173"]);
  });

  it("prints JSON with each route's name, key and value", async () => {
    const { out } = await run({ json: true, names: ["docs"] });
    expect(JSON.parse(out[0] ?? "")).toEqual({
      source: "studio",
      variables: [{ name: "docs", key: "DOCS_URL", value: "http://docs.localhost:1355" }],
    });
  });

  it("reads portless directly when Studio is not running, noting it on stderr", async () => {
    const { code, out, errors, localReads } = await run({}, false);
    expect(code).toBe(0);
    expect(localReads).toBe(1);
    expect(out).toHaveLength(1);
    expect(errors.join("\n")).toContain("Studio is not running");
  });

  it("fails with exit code 1 when a name matches no route", async () => {
    const { code, out, errors } = await run({ names: ["shop"] });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(errors).toEqual(['Error: No route matches "shop".']);
  });

  it("fails with exit code 1 on a prefix that is not a variable name", async () => {
    const { code, errors } = await run({ prefix: "1x" });
    expect(code).toBe(1);
    expect(errors[0]).toContain('The prefix "1x"');
  });
});
