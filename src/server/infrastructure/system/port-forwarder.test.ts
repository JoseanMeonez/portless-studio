import { createHash } from "node:crypto";
import { Agent, createServer, request, type Server } from "node:http";
import { type AddressInfo, connect, createServer as createTcpServer } from "node:net";
import { startForwarder } from "./port-forwarder.ts";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen({ port: 0, host: "127.0.0.1" }, () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
}

/** Stands in for the portless proxy: echoes what it got, and answers WebSocket upgrades. */
function fakeProxy() {
  const connections = new Set<string>();
  const server = createServer((req, res) => {
    connections.add(`${req.socket.remotePort}`);
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "x-portless": "1" });
      res.end(JSON.stringify({ host: req.headers.host, method: req.method, url: req.url, body }));
    });
  });
  server.on("upgrade", (req, socket) => {
    const key = String(req.headers["sec-websocket-key"]);
    const accept = createHash("sha1")
      .update(key + WS_GUID)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    // Echoes raw frames back, enough to prove the socket stays piped after the upgrade.
    socket.on("data", (data: Buffer) => socket.write(data));
  });
  return { server, connections };
}

type Reply = { status: number; json: Record<string, string> };

function send(
  port: number,
  options: { method?: string; host: string; body?: string; agent?: Agent },
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: "/api/items?x=1",
        headers: { host: options.host },
        agent: options.agent ?? false,
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

describe("startForwarder", () => {
  const cleanup: Array<() => unknown> = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  async function forwarderTo(target: number) {
    const started = await startForwarder({ port: 0, hosts: ["127.0.0.1"], targetPort: target });
    if (!started.ok) throw new Error(started.error.message);
    cleanup.push(() => started.value.close());
    return started.value;
  }

  it("forwards requests with their Host, method, path and body untouched", async () => {
    const proxy = fakeProxy();
    const target = await listen(proxy.server);
    cleanup.push(() => proxy.server.close());
    const forwarder = await forwarderTo(target);

    const reply = await send(forwarder.port, {
      method: "POST",
      host: "web.acme.localhost",
      body: "a=1",
    });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({
      host: "web.acme.localhost",
      method: "POST",
      url: "/api/items?x=1",
      body: "a=1",
    });
  });

  it("keeps a keep-alive connection open across requests", async () => {
    const proxy = fakeProxy();
    const target = await listen(proxy.server);
    cleanup.push(() => proxy.server.close());
    const forwarder = await forwarderTo(target);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    cleanup.push(() => agent.destroy());

    await send(forwarder.port, { host: "a.localhost", agent });
    await send(forwarder.port, { host: "a.localhost", agent });
    expect(proxy.connections.size).toBe(1);
  });

  it("passes a WebSocket upgrade through and keeps the socket piped", async () => {
    const proxy = fakeProxy();
    const target = await listen(proxy.server);
    cleanup.push(() => proxy.server.close());
    const forwarder = await forwarderTo(target);

    const socket = connect({ host: "127.0.0.1", port: forwarder.port });
    cleanup.push(() => socket.destroy());
    const received: string[] = [];
    const handshake = new Promise<void>((resolve) => {
      socket.on("data", (data: Buffer) => {
        received.push(data.toString());
        if (received.length === 1) resolve();
      });
    });
    socket.write(
      "GET /ws HTTP/1.1\r\nHost: web.acme.localhost\r\nUpgrade: websocket\r\n" +
        "Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
    await handshake;
    expect(received[0]).toContain("101 Switching Protocols");
    expect(received[0]).toContain("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");

    const echoed = new Promise<string>((resolve) => socket.once("data", (d) => resolve(String(d))));
    socket.write("frame-after-upgrade");
    expect(await echoed).toBe("frame-after-upgrade");
  });

  it("closes the client connection when nothing listens on the target", async () => {
    const free = createTcpServer();
    const target = await listen(free);
    await new Promise((resolve) => free.close(resolve));
    const forwarder = await forwarderTo(target);

    const closed = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: forwarder.port });
      socket.on("error", () => resolve(true));
      socket.on("close", () => resolve(true));
    });
    expect(closed).toBe(true);
  });

  it("reports a port another program holds as in-use and listens on nothing", async () => {
    const holder = createTcpServer();
    const port = await listen(holder);
    cleanup.push(() => holder.close());

    const started = await startForwarder({ port, hosts: ["127.0.0.1"], targetPort: 1 });
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.reason).toBe("in-use");
      expect(started.error.message).toBe(`port ${port} is in use by another program.`);
    }
  });

  it("stops accepting connections once closed", async () => {
    const proxy = fakeProxy();
    const target = await listen(proxy.server);
    cleanup.push(() => proxy.server.close());
    const started = await startForwarder({ port: 0, hosts: ["127.0.0.1"], targetPort: target });
    if (!started.ok) throw new Error(started.error.message);
    await started.value.close();

    const refused = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: "127.0.0.1", port: started.value.port });
      socket.on("error", () => resolve(true));
      socket.on("connect", () => resolve(false));
    });
    expect(refused).toBe(true);
  });
});
