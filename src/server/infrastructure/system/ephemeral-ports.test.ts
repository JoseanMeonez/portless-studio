import {
  ephemeralRangeReader,
  parseLinuxPortRange,
  parseNetshDynamicPorts,
  parseSysctlPortRange,
} from "./ephemeral-ports.ts";
import type { SystemIo } from "./system-io.ts";

function fakeIo(files: Record<string, string>, stdout = ""): SystemIo & { runs: string[][] } {
  const runs: string[][] = [];
  return {
    runs,
    readFile: (path) => files[path] ?? null,
    readDir: () => [],
    readLink: () => null,
    run: async (bin, args) => {
      runs.push([bin, ...args]);
      return { exitCode: 0, stdout };
    },
  };
}

describe("ephemeral port range parsers", () => {
  it("reads the Linux range file", () => {
    expect(parseLinuxPortRange("32768\t60999\n")).toEqual({ first: 32768, last: 60999 });
    expect(parseLinuxPortRange("")).toBeNull();
    expect(parseLinuxPortRange("9000 100")).toBeNull();
  });

  it("reads sysctl's two lines", () => {
    expect(parseSysctlPortRange("49152\n65535\n")).toEqual({ first: 49152, last: 65535 });
  });

  it("reads netsh's start port and count", () => {
    const text = [
      "Protocol tcp Dynamic Port Range",
      "---------------------------------",
      "Start Port      : 49152",
      "Number of Ports : 16384",
    ].join("\r\n");
    expect(parseNetshDynamicPorts(text)).toEqual({ first: 49152, last: 65535 });
    expect(parseNetshDynamicPorts("nothing")).toBeNull();
  });
});

describe("ephemeralRangeReader", () => {
  it("reads Linux once and keeps the answer", async () => {
    const io = fakeIo({ "/proc/sys/net/ipv4/ip_local_port_range": "40000 50000\n" });
    const read = ephemeralRangeReader("linux", io);
    expect(await read()).toEqual({ first: 40000, last: 50000 });
    io.readFile = () => "1 2";
    expect(await read()).toEqual({ first: 40000, last: 50000 });
  });

  it("asks sysctl on macOS and netsh on Windows", async () => {
    const mac = fakeIo({}, "49152\n65535\n");
    expect(await ephemeralRangeReader("darwin", mac)()).toEqual({ first: 49152, last: 65535 });
    expect(mac.runs[0]?.[0]).toBe("sysctl");
    const win = fakeIo({}, "Start Port : 1025\nNumber of Ports : 3976\n");
    expect(await ephemeralRangeReader("win32", win)()).toEqual({ first: 1025, last: 5000 });
    expect(win.runs[0]?.[0]).toBe("netsh");
  });

  it("falls back to the platform default when the setting cannot be read", async () => {
    expect(await ephemeralRangeReader("linux", fakeIo({}))()).toEqual({
      first: 32768,
      last: 60999,
    });
    expect(await ephemeralRangeReader("darwin", fakeIo({}))()).toEqual({
      first: 49152,
      last: 65535,
    });
  });
});
