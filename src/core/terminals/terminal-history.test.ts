import { MAX_RECENT_COMMANDS, parseTerminalHistory, rememberCommand } from "./terminal-history.ts";

const saved = {
  command: "pnpm dev",
  cwd: "/work/shop",
  title: "pnpm dev",
  startedAt: 5,
  startedBy: "program",
  project: "shop",
  worktree: null,
  branch: "main",
};

describe("parseTerminalHistory", () => {
  it("keeps valid entries and drops the rest", () => {
    expect(
      parseTerminalHistory({
        running: [saved, { ...saved, cwd: "" }, { ...saved, startedBy: "robot" }, 3],
        recentCommands: { "/work/shop": ["pnpm dev", 4, " "], "/work/x": "pnpm test" },
      }),
    ).toEqual({ running: [saved], recentCommands: { "/work/shop": ["pnpm dev"] } });
  });

  it("reads anything else as an empty history", () => {
    expect(parseTerminalHistory(null)).toEqual({ running: [], recentCommands: {} });
    expect(parseTerminalHistory("x")).toEqual({ running: [], recentCommands: {} });
  });
});

describe("rememberCommand", () => {
  it("puts the command first, once, per folder", () => {
    const first = rememberCommand({}, "/a", "pnpm dev");
    const second = rememberCommand(first, "/a", "pnpm test");
    expect(rememberCommand(second, "/a", " pnpm dev ")).toEqual({
      "/a": ["pnpm dev", "pnpm test"],
    });
    expect(first).toEqual({ "/a": ["pnpm dev"] });
  });

  it("keeps only the newest commands and ignores empty ones", () => {
    let recent: Record<string, string[]> = {};
    for (let index = 0; index < MAX_RECENT_COMMANDS + 5; index += 1) {
      recent = rememberCommand(recent, "/a", `cmd ${index}`);
    }
    expect(recent["/a"]).toHaveLength(MAX_RECENT_COMMANDS);
    expect(recent["/a"]?.[0]).toBe(`cmd ${MAX_RECENT_COMMANDS + 4}`);
    expect(rememberCommand(recent, "/b", "  ")).toEqual(recent);
  });
});
