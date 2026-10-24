import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { API_PATHS } from "../core/api/contract.ts";
import { type RunningServer, startServer } from "./main.ts";

let dir: string;
let running: RunningServer | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(async () => {
  await running?.close();
  running = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("startServer", () => {
  it("serves the snapshot of the given state directory on loopback", async () => {
    fs.writeFileSync(
      path.join(dir, "routes.json"),
      JSON.stringify([{ hostname: "db.localhost", port: 5432, pid: 0 }]),
    );
    running = await startServer({ port: 0, stateDir: dir, portlessBin: "portless" });
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(running.token.length).toBeGreaterThanOrEqual(32);

    const response = await fetch(`${running.url}${API_PATHS.snapshot}`);
    const snapshot = (await response.json()) as { routes: { name: string }[] };
    expect(snapshot.routes.map((r) => r.name)).toEqual(["db"]);
  });

  it("creates a different token on every run", async () => {
    const first = await startServer({ port: 0, stateDir: dir });
    const second = await startServer({ port: 0, stateDir: dir });
    expect(first.token).not.toBe(second.token);
    await first.close();
    await second.close();
  });
});
