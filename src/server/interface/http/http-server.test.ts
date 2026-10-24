import * as fs from "node:fs";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { gunzipSync } from "node:zlib";
import { API_PATHS, type Snapshot, TOKEN_HEADER } from "../../../core/api/contract.ts";
import { ok } from "../../../core/result.ts";
import type { Route } from "../../../core/routes/route.ts";
import type { RouteRegistry } from "../../application/route-registry.ts";
import { createHttpServer, type HttpServer } from "./http-server.ts";

const TOKEN = "test-token";

const alias: Route = {
  hostname: "db.localhost",
  name: "db",
  port: 5432,
  kind: "alias",
  pid: null,
  registeredAt: null,
  url: "http://db.localhost:1355",
  tunnels: [],
};

function fakeRegistry() {
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  let routes: Route[] = [alias];
  const registry: RouteRegistry = {
    readSnapshot: async (): Promise<Snapshot> => ({
      proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
      routes,
      readAt: 1,
    }),
    watch: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    createAlias: async (name, port, force) => {
      calls.push(`create ${name} ${port} ${force}`);
      return ok(undefined);
    },
    removeAlias: async (name) => {
      calls.push(`remove ${name}`);
      return ok(undefined);
    },
  };
  const change = (next: Route[]) => {
    routes = next;
    for (const listener of listeners) listener();
  };
  return { registry, calls, change, listeners };
}

type Reply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

let http: HttpServer;
let port: number;
let webDir: string;
let fake: ReturnType<typeof fakeRegistry>;

async function start(withWeb = true) {
  fake = fakeRegistry();
  http = createHttpServer({
    registry: fake.registry,
    token: TOKEN,
    webDir: withWeb ? webDir : undefined,
  });
  await new Promise<void>((resolve) => http.server.listen(0, "127.0.0.1", resolve));
  port = (http.server.address() as AddressInfo).port;
}

function send(
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path: pathname, headers, setHost: !("host" in headers) },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

const json = (reply: Reply): unknown => JSON.parse(reply.body.toString());
const write = { [TOKEN_HEADER]: TOKEN, "content-type": "application/json" };

beforeEach(async () => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), "portless-studio-"));
  fs.mkdirSync(path.join(webDir, "assets"));
  fs.writeFileSync(path.join(webDir, "index.html"), `<!doctype html><title>Studio</title>`);
  fs.writeFileSync(path.join(webDir, "assets", "app-1a2b.js"), `console.log(1);\n`.repeat(200));
  await start();
});

afterEach(async () => {
  http.closeStreams();
  http.server.closeAllConnections();
  await new Promise((resolve) => http.server.close(resolve));
  fs.rmSync(webDir, { recursive: true, force: true });
});

describe("API reads", () => {
  it("returns the snapshot as JSON", async () => {
    const reply = await send("GET", API_PATHS.snapshot);
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toContain("application/json");
    expect(json(reply)).toMatchObject({ routes: [{ name: "db" }], proxy: { port: 1355 } });
    expect(reply.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the session token to a same-origin request", async () => {
    const reply = await send("GET", API_PATHS.session, { origin: `http://127.0.0.1:${port}` });
    expect(json(reply)).toEqual({ token: TOKEN });
  });

  it("answers unknown API paths with not_found", async () => {
    const reply = await send("GET", "/api/nope");
    expect(reply.status).toBe(404);
    expect(json(reply)).toMatchObject({ error: "not_found" });
  });
});

describe("guards", () => {
  it("rejects a foreign Host", async () => {
    const reply = await send("GET", API_PATHS.snapshot, { host: "evil.example:80" });
    expect(reply.status).toBe(403);
    expect(json(reply)).toMatchObject({ error: "forbidden" });
  });

  it("accepts a .localhost Host", async () => {
    const reply = await send("GET", API_PATHS.snapshot, { host: "studio.localhost:1355" });
    expect(reply.status).toBe(200);
  });

  it("rejects a foreign Origin, even for reads", async () => {
    const reply = await send("GET", API_PATHS.session, { origin: "http://evil.example" });
    expect(reply.status).toBe(403);
  });

  it("rejects a write without the token and does not touch the registry", async () => {
    const reply = await send("POST", API_PATHS.aliases, {}, JSON.stringify({ name: "x", port: 1 }));
    expect(reply.status).toBe(403);
    expect(json(reply)).toMatchObject({ error: "forbidden" });
    expect(fake.calls).toEqual([]);
  });

  it("rejects a write with a wrong token", async () => {
    const reply = await send("DELETE", API_PATHS.alias("db"), { [TOKEN_HEADER]: "nope" });
    expect(reply.status).toBe(403);
    expect(fake.calls).toEqual([]);
  });
});

describe("API writes", () => {
  it("creates an alias", async () => {
    const body = JSON.stringify({ name: "web", port: 3000 });
    const reply = await send("POST", API_PATHS.aliases, write, body);
    expect(reply.status).toBe(201);
    expect(fake.calls).toEqual(["create web 3000 false"]);
  });

  it("returns invalid_port as 400", async () => {
    const body = JSON.stringify({ name: "web", port: "abc" });
    const reply = await send("POST", API_PATHS.aliases, write, body);
    expect(reply.status).toBe(400);
    expect(json(reply)).toMatchObject({ error: "invalid_port" });
  });

  it("renames an alias", async () => {
    const body = JSON.stringify({ name: "pg" });
    const reply = await send("PATCH", API_PATHS.alias("db"), write, body);
    expect(reply.status).toBe(204);
    expect(fake.calls).toEqual(["create pg 5432 false", "remove db"]);
  });

  it("removes an alias and reports an unknown one as 404", async () => {
    expect((await send("DELETE", API_PATHS.alias("db"), write)).status).toBe(204);
    const missing = await send("DELETE", API_PATHS.alias("nope"), write);
    expect(missing.status).toBe(404);
    expect(fake.calls).toEqual(["remove db"]);
  });

  it("rejects a body over 16 KB with 413", async () => {
    const body = JSON.stringify({ name: "x".repeat(20_000), port: 1 });
    const reply = await send("POST", API_PATHS.aliases, write, body);
    expect(reply.status).toBe(413);
    expect(fake.calls).toEqual([]);
  });

  it("rejects malformed JSON with 400", async () => {
    const reply = await send("POST", API_PATHS.aliases, write, "{nope");
    expect(reply.status).toBe(400);
    expect(json(reply)).toMatchObject({ error: "invalid_request" });
  });
});

describe("events", () => {
  it("sends the snapshot on connect and after a change", async () => {
    const received: string[] = [];
    const done = new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port, path: API_PATHS.events }, (res) => {
        expect(res.headers["content-type"]).toContain("text/event-stream");
        res.on("data", (chunk: Buffer) => {
          received.push(chunk.toString());
          if (received.length === 1) fake.change([]);
          if (received.length === 2) {
            req.destroy();
            resolve();
          }
        });
      });
      req.end();
    });
    await done;
    expect(received[0]).toMatch(/^event: snapshot\ndata: \{.*"name":"db".*\}\n\n$/);
    expect(received[1]).toContain('"routes":[]');
    await vi.waitFor(() => expect(fake.listeners.size).toBe(0));
  });
});

describe("static files", () => {
  it("serves index.html for app paths with no-cache and security headers", async () => {
    const reply = await send("GET", "/settings/routes");
    expect(reply.status).toBe(200);
    expect(reply.body.toString()).toContain("<title>Studio</title>");
    expect(reply.headers["cache-control"]).toBe("no-cache");
    expect(reply.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(reply.headers["x-content-type-options"]).toBe("nosniff");
    expect(reply.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("serves hashed assets as immutable and compressed", async () => {
    const reply = await send("GET", "/assets/app-1a2b.js", { "accept-encoding": "gzip" });
    expect(reply.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(reply.headers["content-type"]).toContain("text/javascript");
    expect(reply.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(reply.body).toString()).toContain("console.log(1);");
  });

  it("returns 404 for a missing asset instead of the app shell", async () => {
    expect((await send("GET", "/assets/missing.js")).status).toBe(404);
  });

  it.each(["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/..%2f..%2fetc%2fpasswd"])(
    "blocks traversal through %s",
    async (attempt) => {
      const reply = await send("GET", attempt);
      expect(reply.body.toString()).not.toContain("root:");
      expect([200, 404]).toContain(reply.status);
      if (reply.status === 200) expect(reply.body.toString()).toContain("<title>Studio</title>");
    },
  );

  it("answers non-API paths with a hint when the web app is not built", async () => {
    http.closeStreams();
    http.server.closeAllConnections();
    await new Promise((resolve) => http.server.close(resolve));
    await start(false);
    const reply = await send("GET", "/");
    expect(reply.status).toBe(404);
    expect(reply.body.toString()).toContain("pnpm dev:web");
  });
});
