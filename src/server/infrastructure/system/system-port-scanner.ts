import { request } from "node:http";
import { STUDIO_HEADER } from "../../../core/api/contract.ts";
import type { HttpProbe, ListeningPort, PortScanner } from "../../application/port-scanner.ts";
import { listLinuxPorts } from "./linux-ports.ts";
import { listMacosPorts } from "./macos-ports.ts";
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
  if (platform === "win32") return () => listWindowsPorts(io);
  if (platform === "darwin") return () => listMacosPorts(io);
  return () => listLinuxPorts(io);
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
    for (const key of this.#answers.keys()) {
      const [port, pid] = key.split(":");
      if (String(this.#pidByPort.get(Number(port))) !== pid) this.#answers.delete(key);
    }
    return ports;
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
