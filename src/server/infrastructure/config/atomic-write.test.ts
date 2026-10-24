import { type AtomicWriteFs, writeFileAtomic } from "./atomic-write.ts";

function fakeFs(renameFailures: (NodeJS.ErrnoException | null)[]) {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const fs: AtomicWriteFs = {
    mkdirSync: () => undefined,
    writeFileSync: (file, text) => {
      calls.push(`write ${file}`);
      files.set(file, text);
    },
    renameSync: (from, to) => {
      calls.push(`rename ${from} ${to}`);
      const failure = renameFailures.shift();
      if (failure) throw failure;
      files.set(to, files.get(from) ?? "");
      files.delete(from);
    },
    copyFileSync: (from, to) => {
      calls.push(`copy ${from} ${to}`);
      files.set(to, files.get(from) ?? "");
    },
    rmSync: (file) => {
      calls.push(`rm ${file}`);
      files.delete(file);
    },
  };
  return { fs, files, calls };
}

const locked = () => Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });

describe("writeFileAtomic", () => {
  it("retries a rename Windows refuses while another program has the file open", () => {
    const { fs, files, calls } = fakeFs([locked(), locked()]);
    const waits: number[] = [];
    writeFileAtomic("/cfg/config.json", "{}", { fs, pid: 7, sleep: (ms) => waits.push(ms) });
    expect(files.get("/cfg/config.json")).toBe("{}");
    expect(calls.filter((call) => call.startsWith("rename"))).toHaveLength(3);
    expect(waits).toEqual([20, 40]);
  });

  it("copies over the file when the rename keeps failing", () => {
    const { fs, files } = fakeFs(Array.from({ length: 10 }, locked));
    writeFileAtomic("/cfg/config.json", "{}", { fs, pid: 7, sleep: () => {} });
    expect(files.get("/cfg/config.json")).toBe("{}");
    expect(files.has("/cfg/config.json.7.tmp")).toBe(false);
  });

  it("removes the temporary file and throws on any other error", () => {
    const full = Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    const { fs, files } = fakeFs([full]);
    expect(() =>
      writeFileAtomic("/cfg/config.json", "{}", { fs, pid: 7, sleep: () => {} }),
    ).toThrow("ENOSPC");
    expect(files.size).toBe(0);
  });
});
