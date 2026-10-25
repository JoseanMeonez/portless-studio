import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { JsonTerminalHistoryStore, terminalHistoryPathFor } from "./json-terminal-history-store.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-terminals-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("JsonTerminalHistoryStore", () => {
  it("sits next to the config file", () => {
    expect(terminalHistoryPathFor(path.join(dir, "config.json"))).toBe(
      path.join(dir, "terminals.json"),
    );
  });

  it("reads back what it wrote, and an empty history when the file is missing or broken", () => {
    const file = path.join(dir, "terminals.json");
    const store = new JsonTerminalHistoryStore(file);
    expect(store.read()).toEqual({ running: [], recentCommands: {} });
    const history = {
      running: [
        {
          command: "pnpm dev",
          cwd: "/work/shop",
          title: "pnpm dev",
          startedAt: 1,
          startedBy: "person" as const,
          project: null,
          worktree: null,
          branch: null,
        },
      ],
      recentCommands: { "/work/shop": ["pnpm dev"] },
    };
    store.write(history);
    expect(store.read()).toEqual(history);
    fs.writeFileSync(file, "{ nope");
    expect(store.read()).toEqual({ running: [], recentCommands: {} });
  });
});
