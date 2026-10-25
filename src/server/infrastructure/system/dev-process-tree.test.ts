import { devProcessTree } from "./dev-process-tree.ts";

describe("devProcessTree", () => {
  const table = [
    { pid: 10, parent: 1, command: "claude --dangerously-skip-permissions" },
    { pid: 20, parent: 10, command: "bash" },
    { pid: 30, parent: 20, command: "node /tools/pnpm.cjs dev" },
    { pid: 40, parent: 30, command: "sh -c turbo dev" },
    { pid: 50, parent: 40, command: "node /tools/turbo dev" },
    { pid: 60, parent: 50, command: "node /tools/vite/bin/vite.js" },
    { pid: 70, parent: 50, command: "node /tools/wrangler/bin/wrangler.js dev" },
    { pid: 80, parent: 20, command: "node unrelated.js" },
  ];
  it("selects the whole dev command below the interactive shell and agent", () => {
    expect(devProcessTree(60, table)).toEqual([30, 70, 60, 50, 40]);
  });
  it("stops at an unknown supervisor", () => {
    expect(devProcessTree(80, table)).toEqual([80]);
  });
  it("does not cross a shell running another command", () => {
    expect(
      devProcessTree(
        60,
        table.map((p) => (p.pid === 40 ? { ...p, command: "bash" } : p)),
      ),
    ).toEqual([50, 70, 60]);
  });
  it("does not mistake agent arguments for an executable", () => {
    const changed = table.map((p) => (p.pid === 30 ? { ...p, command: 'claude "pnpm dev"' } : p));
    expect(devProcessTree(60, changed)).toEqual([50, 70, 60]);
  });
  it("crosses Windows package-script command shells but not interactive cmd", () => {
    const windows = [
      { pid: 10, parent: 1, command: '"C:\\Windows\\System32\\cmd.exe"' },
      { pid: 20, parent: 10, command: "node C:\\tools\\pnpm.cjs dev" },
      { pid: 30, parent: 20, command: '"C:\\Windows\\System32\\cmd.exe" /d /s /c turbo dev' },
      { pid: 40, parent: 30, command: "C:\\tools\\turbo.exe dev" },
      { pid: 50, parent: 40, command: "node C:\\tools\\pnpm.cjs dev" },
      { pid: 60, parent: 50, command: "cmd.exe /d /s /c vite" },
      { pid: 70, parent: 60, command: "node C:\\tools\\vite.js" },
      { pid: 80, parent: 40, command: "node C:\\tools\\wrangler.js dev" },
    ];
    expect(devProcessTree(70, windows)).toEqual([20, 70, 60, 80, 50, 40, 30]);
    expect(
      devProcessTree(
        70,
        windows.map((p) => (p.pid === 60 ? { ...p, command: "cmd.exe" } : p)),
      ),
    ).toEqual([70]);
    expect(
      devProcessTree(
        70,
        windows.map((p) => (p.pid === 60 ? { ...p, command: "cmd.exe /k vite" } : p)),
      ),
    ).toEqual([70]);
  });
  it("refuses a missing pid", () => {
    expect(devProcessTree(999, table)).toEqual([]);
  });
});
