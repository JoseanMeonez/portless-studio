import { DEFAULT_EPHEMERAL_RANGES, type PortRange } from "../../../core/ports/helper-ports.ts";
import type { SystemIo } from "./system-io.ts";

/** Reads `/proc/sys/net/ipv4/ip_local_port_range`: two numbers separated by whitespace. */
export function parseLinuxPortRange(text: string): PortRange | null {
  const [first, last] = text.trim().split(/\s+/).map(Number);
  return validRange(first, last);
}

/** Reads `sysctl -n net.inet.ip.portrange.first net.inet.ip.portrange.last`: one number per line. */
export function parseSysctlPortRange(text: string): PortRange | null {
  return parseLinuxPortRange(text);
}

/** Reads `netsh int ipv4 show dynamicport tcp`: a start port and a number of ports. */
export function parseNetshDynamicPorts(text: string): PortRange | null {
  const numbers = [...text.matchAll(/:\s*(\d+)/g)].map((match) => Number(match[1]));
  const [start, count] = numbers;
  if (start === undefined || count === undefined || count < 1) return null;
  return validRange(start, start + count - 1);
}

function validRange(first: number | undefined, last: number | undefined): PortRange | null {
  if (first === undefined || last === undefined) return null;
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  if (first < 1 || last > 65535 || first > last) return null;
  return { first, last };
}

/**
 * The range the system hands out for port 0, read once and kept: it only changes when someone
 * edits a kernel setting. Falls back to the platform default when it cannot be read.
 */
export function ephemeralRangeReader(
  platform: NodeJS.Platform,
  io: SystemIo,
): () => Promise<PortRange> {
  let reading: Promise<PortRange> | null = null;
  return () => {
    reading ??= readEphemeralRange(platform, io).catch(() => fallbackRange(platform));
    return reading;
  };
}

async function readEphemeralRange(platform: NodeJS.Platform, io: SystemIo): Promise<PortRange> {
  let range: PortRange | null = null;
  if (platform === "linux") {
    range = parseLinuxPortRange(io.readFile("/proc/sys/net/ipv4/ip_local_port_range") ?? "");
  } else if (platform === "darwin") {
    const out = await io.run("sysctl", [
      "-n",
      "net.inet.ip.portrange.first",
      "net.inet.ip.portrange.last",
    ]);
    range = parseSysctlPortRange(out.stdout);
  } else if (platform === "win32") {
    const out = await io.run("netsh", ["int", "ipv4", "show", "dynamicport", "tcp"]);
    range = parseNetshDynamicPorts(out.stdout);
  }
  return range ?? fallbackRange(platform);
}

function fallbackRange(platform: NodeJS.Platform): PortRange {
  if (platform === "darwin" || platform === "win32") return DEFAULT_EPHEMERAL_RANGES[platform];
  return DEFAULT_EPHEMERAL_RANGES.linux;
}
