import { createServer, type Server } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";
import type { ListeningPort } from "../../application/port-scanner.ts";
import { probeHttp, SystemPortScanner } from "./system-port-scanner.ts";

const servers: { close(callback: () => void): void }[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
}

async function closedPort(): Promise<number> {
  const server = createTcpServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("probeHttp", () => {
  it("is true for a server that answers HTTP, whatever the status", async () => {
    const port = await listen(createServer((_req, res) => res.writeHead(403).end()));
    expect(await probeHttp(port, 800)).toBe(true);
  });

  it("is false for a closed port", async () => {
    expect(await probeHttp(await closedPort(), 800)).toBe(false);
  });

  it("is false for a TCP server that never answers", async () => {
    // Reads and ignores whatever arrives, like a database would.
    const port = await listen(createTcpServer((socket) => socket.resume()));
    expect(await probeHttp(port, 150)).toBe(false);
  });
});

describe("SystemPortScanner", () => {
  it("probes a port once per process", async () => {
    let requests = 0;
    const port = await listen(
      createServer((_req, res) => {
        requests += 1;
        res.end();
      }),
    );
    let pid = 10;
    const list = async (): Promise<ListeningPort[]> => [
      { port, pid, processName: "node", cwd: null },
    ];
    const scanner = new SystemPortScanner(list);

    await scanner.scan();
    expect(await scanner.answersHttp(port)).toBe(true);
    expect(await scanner.answersHttp(port)).toBe(true);
    expect(requests).toBe(1);

    pid = 11;
    await scanner.scan();
    expect(await scanner.answersHttp(port)).toBe(true);
    expect(requests).toBe(2);
  });

  it("returns an empty list when listing fails", async () => {
    const scanner = new SystemPortScanner(async () => {
      throw new Error("boom");
    });
    expect(await scanner.scan()).toEqual([]);
  });
});
