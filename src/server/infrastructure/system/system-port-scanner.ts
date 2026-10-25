import { request } from "node:http";
import { STUDIO_HEADER } from "../../../core/api/contract.ts";
import { type DebuggerProbe, isDebuggerVersionInfo } from "../../../core/ports/helper-ports.ts";
import type { HttpProbe, ListeningPort, PortScanner } from "../../application/port-scanner.ts";
import { listLinuxPorts, readClockTicks } from "./linux-ports.ts";
import { listMacosPorts, type StartTimeCache } from "./macos-ports.ts";
import { nodeSystemIo, type SystemIo } from "./system-io.ts";
import { listWindowsPorts } from "./windows-ports.ts";

/** Dev servers answer in milliseconds; a database or chat app never answers and costs this long. */
const PROBE_TIMEOUT_MS = 800;
const LOOPBACK_HOSTS = ["127.0.0.1", "::1"];

export type ListPorts = () => Promise<ListeningPort[]>;

/** The lister for this operating system: `/proc` on Linux, `lsof` on macOS, `netstat` on Windows. */
export function createPortScanner(
  platform: NodeJS.Platform = process.platform,
  io: SystemIo = nodeSystemIo,
): SystemPortScanner {
  return new SystemPortScanner(listPortsFor(platform, io));
}

/** The raw listing for this operating system, without the HTTP check. */
export function listPortsFor(platform: NodeJS.Platform, io: SystemIo): ListPorts {
  if (platform === "win32") {
    const cache = new Map();
    return () => listWindowsPorts(io, cache);
  }
  if (platform === "darwin") {
    const starts: StartTimeCache = new Map();
    return () => listMacosPorts(io, starts);
  }
  let ticks: Promise<number> | null = null;
  return () => listLinuxPorts(io, () => (ticks ??= readClockTicks(io)));
}

/**
 * Wraps a platform lister with the HTTP check. A port is probed once per process that owns it,
 * because a process does not start or stop speaking HTTP on a port it keeps.
 */
export class SystemPortScanner implements PortScanner {
  readonly #list: ListPorts;
  readonly #timeoutMs: number;
  #pidByPort = new Map<number, number | null>();
  readonly #answers = new Map<string, Promise<boolean>>();
  readonly #debuggers = new Map<string, Promise<DebuggerProbe>>();

  constructor(list: ListPorts, timeoutMs = PROBE_TIMEOUT_MS) {
    this.#list = list;
    this.#timeoutMs = timeoutMs;
  }

  async scan(): Promise<ListeningPort[]> {
    let ports: ListeningPort[];
    try {
      ports = await this.#list();
    } catch {
      ports = [];
    }
    this.#pidByPort = new Map(ports.map((port) => [port.port, port.pid]));
    // Forget answers for processes that are gone, so the cache does not grow forever.
    for (const cache of [this.#answers, this.#debuggers]) {
      for (const key of cache.keys()) {
        const [port, pid] = key.split(":");
        if (String(this.#pidByPort.get(Number(port))) !== pid) cache.delete(key);
      }
    }
    return ports;
  }

  /** Asked once per port and process, like `answersHttp`. */
  probeDebugger(port: number): Promise<DebuggerProbe> {
    const pid = this.#pidByPort.get(port) ?? null;
    if (pid === null) return probeDebuggerPort(port, this.#timeoutMs);
    const key = `${port}:${pid}`;
    let answer = this.#debuggers.get(key);
    if (!answer) {
      answer = probeDebuggerPort(port, this.#timeoutMs);
      this.#debuggers.set(key, answer);
    }
    return answer;
  }

  answersHttp(port: number): Promise<boolean> {
    const pid = this.#pidByPort.get(port) ?? null;
    // Without a pid we cannot tell a restarted process apart, so the answer is not kept.
    if (pid === null) return probeHttp(port, this.#timeoutMs);
    const key = `${port}:${pid}`;
    let answer = this.#answers.get(key);
    if (!answer) {
      answer = probeHttp(port, this.#timeoutMs);
      this.#answers.set(key, answer);
    }
    return answer;
  }
}

/** A `/json/version` answer is a few hundred bytes; anything longer is not a debugger. */
const MAX_VERSION_BODY = 16_384;

/**
 * Asks `GET /json/version`, which Node's inspector and Chrome DevTools answer with JSON naming
 * the browser and protocol. `other` when the port answered something else, `unknown` when
 * nothing answered in time.
 */
export async function probeDebuggerPort(
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<DebuggerProbe> {
  for (const host of LOOPBACK_HOSTS) {
    const body = await getText(host, port, "/json/version", timeoutMs);
    if (body === null) continue;
    try {
      return isDebuggerVersionInfo(JSON.parse(body)) ? "debugger" : "other";
    } catch {
      return "other";
    }
  }
  return "unknown";
}

function getText(
  host: string,
  port: number,
  path: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const options = { host, port, method: "GET", path, timeout: timeoutMs, agent: false };
    const req = request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
        if (body.length <= MAX_VERSION_BODY) return;
        resolve("");
        req.destroy();
      });
      res.on("end", () => resolve(body));
      res.on("error", () => resolve(body));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.on("close", () => resolve(null));
    req.end();
  });
}

/**
 * True when anything on loopback answers `HEAD /` with an HTTP response, whatever its status,
 * unless the response comes from a Portless Studio.
 */
export async function probeHttp(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const probe = await probeHttpResponse(port, timeoutMs);
  return probe !== null && !probe.studio;
}

/** The first loopback address that answers `HEAD /`: its status and how long it took. */
export async function probeHttpResponse(
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<HttpProbe | null> {
  for (const host of LOOPBACK_HOSTS) {
    const probe = await probeHost(host, port, timeoutMs);
    if (probe) return probe;
  }
  return null;
}

function probeHost(host: string, port: number, timeoutMs: number): Promise<HttpProbe | null> {
  return new Promise((resolve) => {
    const started = performance.now();
    const options = { host, port, method: "HEAD", path: "/", timeout: timeoutMs, agent: false };
    const req = request(options, (res) => {
      res.resume();
      req.destroy();
      resolve({
        status: res.statusCode ?? 0,
        latencyMs: Math.round(performance.now() - started),
        studio: res.headers[STUDIO_HEADER] !== undefined,
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
    req.on("close", () => resolve(null));
    req.end();
  });
}
