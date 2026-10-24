import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appError } from "../../application/app-error.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import {
  proxyStartRecordPathFor,
  readProxyStartRecord,
  recordProxyStarts,
} from "./proxy-start-record.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function fakeRegistry(startOk: boolean, pid: number | null): RouteRegistry {
  return {
    readSnapshot: async () => {
      throw new Error("not used");
    },
    watch: () => () => {},
    createAlias: async () => ({ ok: true, value: undefined }),
    removeAlias: async () => ({ ok: true, value: undefined }),
    installPortless: async () => ({ ok: true, value: { version: null, output: "" } }),
    startProxy: async () =>
      startOk
        ? { ok: true, value: undefined }
        : { ok: false, error: appError("command_failed", "no") },
    stopProxy: async () => ({ ok: true, value: undefined }),
    proxyPid: async () => pid,
  };
}

describe("recordProxyStarts", () => {
  it("lives next to the config file", () => {
    expect(proxyStartRecordPathFor(path.join("/cfg", "studio", "config.json"))).toBe(
      path.join("/cfg", "studio", "proxy-started.json"),
    );
  });

  it("remembers the pid of a proxy Studio started", async () => {
    const file = path.join(dir, "proxy-started.json");
    const registry = recordProxyStarts(fakeRegistry(true, 4242), file, () => 1000);
    expect(await registry.startProxy(1355, false)).toEqual({ ok: true, value: undefined });
    expect(readProxyStartRecord(file)).toEqual({ pid: 4242, startedAt: 1000 });
  });

  it("records nothing when the start fails, and reads null for a missing or broken file", async () => {
    const file = path.join(dir, "proxy-started.json");
    await recordProxyStarts(fakeRegistry(false, 4242), file).startProxy(1355, false);
    expect(readProxyStartRecord(file)).toBeNull();
    fs.writeFileSync(file, "{ nope");
    expect(readProxyStartRecord(file)).toBeNull();
  });

  it("passes every other call through", async () => {
    const registry = recordProxyStarts(fakeRegistry(true, 7), path.join(dir, "x.json"));
    expect(await registry.proxyPid()).toBe(7);
  });
});
