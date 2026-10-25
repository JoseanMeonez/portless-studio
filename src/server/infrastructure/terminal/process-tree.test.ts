import {
  parsePsParents,
  parseStatParent,
  systemProcessTree,
  walkAncestors,
} from "./process-tree.ts";

describe("process tree", () => {
  it("reads the parent pid from /proc/<pid>/stat, even when the name has spaces and parens", () => {
    expect(parseStatParent("2001 (node) S 1500 2001 1000 0 -1")).toBe(1500);
    expect(parseStatParent("2001 (my (odd) app) R 77 2001 1000 0 -1")).toBe(77);
    expect(parseStatParent("garbage")).toBeNull();
  });

  it("reads every pid's parent from ps", () => {
    const parents = parsePsParents("    1     0\n  1000     1\n 2001  1000\nbad line\n");
    expect([...parents]).toEqual([
      [1, 0],
      [1000, 1],
      [2001, 1000],
    ]);
  });

  it("walks up to the first process and stops on a loop", () => {
    const parents = new Map([
      [2001, 1500],
      [1500, 1000],
      [1000, 1],
      [1, 0],
    ]);
    expect(walkAncestors(2001, (pid) => parents.get(pid) ?? null)).toEqual([1500, 1000, 1]);
    const loop = new Map([
      [5, 6],
      [6, 5],
    ]);
    expect(walkAncestors(5, (pid) => loop.get(pid) ?? null)).toEqual([6]);
  });

  it("says nothing on Windows", async () => {
    expect(await systemProcessTree("win32").ancestors(4)).toEqual([]);
  });

  it.skipIf(process.platform !== "linux")("finds this test's parent on Linux", async () => {
    const ancestors = await systemProcessTree("linux").ancestors(process.pid);
    expect(ancestors[0]).toBe(process.ppid);
  });
});
