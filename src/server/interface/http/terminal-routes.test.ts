import * as fs from "node:fs";
import { type IncomingMessage, request } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { TOKEN_HEADER } from "../../../core/api/contract.ts";
import { ok } from "../../../core/result.ts";
import type { Route } from "../../../core/routes/route.ts";
import type { PortlessState, RouteRegistry } from "../../application/route-registry.ts";
import { StudioRuntime } from "../../application/studio-runtime.ts";
import {
  type TerminalFolders,
  TerminalManager,
  type TerminalProcess,
} from "../../application/terminals.ts";
import { JsonConfigStore } from "../../infrastructure/config/json-config-store.ts";
import { createHttpServer, type HttpServer } from "./http-server.ts";

const TOKEN = "test-token";

const ROUTE: Route = {
  hostname: "web.shop.localhost",
  name: "web.shop",
  port: 3000,
  kind: "alias",
  pid: null,
  registeredAt: 1,
  url: "http://web.shop.localhost:1355",
  tunnels: [],
};

const registry: RouteRegistry = {
  readSnapshot: async (): Promise<PortlessState> => ({
    proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
    portless: { installed: true, version: "1.0.0" },
    routes: [ROUTE],
    readAt: 1,
  }),
  watch: () => () => {},
  createAlias: async () => ok(undefined),
  removeAlias: async () => ok(undefined),
  startProxy: async () => ok(undefined),
  stopProxy: async () => ok(undefined),
  proxyPid: async () => null,
  installPortless: async () => ok({ version: "1.0.0", output: "" }),
};

type Child = TerminalProcess & { emit(text: string): void; written: string[]; calls: string[] };

let http: HttpServer;
let port: number;
let scratch: string;
let children: Child[];
let opened: string[];

const folders: TerminalFolders = {
  directory: (dir) => (fs.existsSync(dir) ? dir : null),
  contains: (parent, child) => child === parent || child.startsWith(`${parent}/`),
};

beforeEach(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studio-http-terminals-"));
  children = [];
  opened = [];
  const studio = new StudioRuntime({
    registry,
    scanner: { scan: async () => [], answersHttp: async () => false },
    configStore: new JsonConfigStore(path.join(scratch, "config.json")),
    projects: {
      read: () => ({ packageName: null, repoName: null, folderName: null, worktreeName: null }),
    },
    log: () => {},
  });
  const terminals = new TerminalManager({
    spawner: {
      mode: "pipes",
      spawn: async () => {
        const listeners: ((text: string) => void)[] = [];
        const child: Child = {
          pid: 77,
          written: [],
          calls: [],
          write: (text) => child.written.push(text),
          interrupt: () => child.calls.push("interrupt"),
          terminate: () => child.calls.push("terminate"),
          kill: () => child.calls.push("kill"),
          onData: (listener) => listeners.push(listener),
          onExit: () => {},
          emit: (text) => {
            for (const listener of listeners) listener(text);
          },
        };
        children.push(child);
        return child;
      },
    },
    workspace: {
      openableFolders: async () => new Set([path.join(scratch, "shown")]),
      snapshot: async () => ({ routes: [], detected: [] }),
      watch: () => () => {},
      createAlias: async () => ok(undefined),
      renameAlias: async () => ok(undefined),
    },
    folders,
  });
  fs.mkdirSync(path.join(scratch, "shown"));
  fs.mkdirSync(path.join(scratch, "other"));
  http = createHttpServer({
    registry,
    studio,
    token: TOKEN,
    terminals,
    openUrl: (url) => opened.push(url),
  });
  await new Promise<void>((resolve) => http.server.listen(0, "127.0.0.1", resolve));
  port = (http.server.address() as AddressInfo).port;
});

afterEach(async () => {
  http.closeStreams();
  await new Promise<void>((resolve) => http.server.close(() => resolve()));
  fs.rmSync(scratch, { recursive: true, force: true });
});

type Reply = { status: number; body: unknown };

function send(
  method: string,
  pathname: string,
  options: { body?: unknown; token?: boolean; origin?: boolean } = {},
): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (options.token !== false) headers[TOKEN_HEADER] = TOKEN;
  if (options.origin) headers.origin = `http://127.0.0.1:${port}`;
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (payload) headers["content-type"] = "application/json";
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path: pathname, headers }, (res) => {
      let text = "";
      res.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null }),
      );
    });
    req.on("error", reject);
    req.end(payload);
  });
}

/** Opens an event stream and collects `event:data` pairs until `close` is called. */
function openStream(pathname: string) {
  const events: { event: string; data: unknown }[] = [];
  let response: IncomingMessage | null = null;
  const req = request({ host: "127.0.0.1", port, path: pathname }, (res) => {
    response = res;
    let buffer = "";
    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let end = buffer.indexOf("\n\n");
      while (end >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) events.push({ event, data: JSON.parse(data) });
        end = buffer.indexOf("\n\n");
      }
    });
  });
  req.end();
  return {
    events,
    status: () => response?.statusCode,
    close: () => req.destroy(),
  };
}

describe("terminal endpoints", () => {
  it("list the recent commands per folder, with the token", async () => {
    const shown = path.join(scratch, "shown");
    await send("POST", "/api/terminals", {
      origin: true,
      body: { cwd: shown, command: "pnpm dev" },
    });
    expect((await send("GET", "/api/terminals/recent-commands", { token: false })).status).toBe(
      403,
    );
    expect(await send("GET", "/api/terminals/recent-commands")).toEqual({
      status: 200,
      body: { recentCommands: { [shown]: ["pnpm dev"] } },
    });
  });

  it("need the token, reads included", async () => {
    expect((await send("GET", "/api/terminals", { token: false })).status).toBe(403);
    expect(await send("GET", "/api/terminals")).toEqual({ status: 200, body: { terminals: [] } });
  });

  it("start a terminal only in a shown folder when a page asks, anywhere for a local program", async () => {
    const other = path.join(scratch, "other");
    const fromPage = await send("POST", "/api/terminals", {
      origin: true,
      body: { cwd: other, command: "ls" },
    });
    expect(fromPage).toMatchObject({ status: 403, body: { error: "path_not_allowed" } });
    const shown = await send("POST", "/api/terminals", {
      origin: true,
      body: { cwd: path.join(scratch, "shown"), command: "ls" },
    });
    expect(shown).toMatchObject({ status: 201, body: { id: "t1", status: "running" } });
    const local = await send("POST", "/api/terminals", { body: { cwd: other, command: "ls" } });
    expect(local).toMatchObject({ status: 201, body: { id: "t2", cwd: other } });
  });

  it("take input, read output, stop and close", async () => {
    await send("POST", "/api/terminals", { body: { cwd: scratch, command: "cat" } });
    expect((await send("POST", "/api/terminals/t1/input", { body: { text: "hi\r" } })).status).toBe(
      204,
    );
    expect(children[0]?.written).toEqual(["hi\r"]);
    children[0]?.emit("hello world");
    expect(await send("GET", "/api/terminals/t1/output?from=6")).toMatchObject({
      status: 200,
      body: { data: "world", from: 6, next: 11, truncated: false, terminal: { id: "t1" } },
    });
    expect((await send("POST", "/api/terminals/t1/stop")).status).toBe(200);
    expect(children[0]?.calls).toEqual(["interrupt"]);
    expect((await send("DELETE", "/api/terminals/t1")).status).toBe(204);
    expect((await send("GET", "/api/terminals/t1")).status).toBe(404);
    expect((await send("POST", "/api/terminals/t1/input", { body: { text: "x" } })).status).toBe(
      404,
    );
  });

  it("open a folder picked by hand from the page, when it is an existing folder", async () => {
    const other = path.join(scratch, "other");
    const picked = await send("POST", "/api/terminals/in-folder", {
      origin: true,
      body: { cwd: other },
    });
    expect(picked).toMatchObject({ status: 201, body: { id: "t1", cwd: other, command: "" } });
    const missing = await send("POST", "/api/terminals/in-folder", {
      origin: true,
      body: { cwd: path.join(scratch, "missing") },
    });
    expect(missing).toMatchObject({ status: 403, body: { error: "path_not_allowed" } });
    const noToken = await send("POST", "/api/terminals/in-folder", {
      origin: true,
      token: false,
      body: { cwd: other },
    });
    expect(noToken.status).toBe(403);
    expect(children).toHaveLength(1);
  });

  it("rename a terminal", async () => {
    await send("POST", "/api/terminals", { body: { cwd: scratch, command: "cat" } });
    expect(
      await send("PATCH", "/api/terminals/t1", { origin: true, body: { title: "notes" } }),
    ).toMatchObject({ status: 200, body: { id: "t1", title: "notes" } });
    expect((await send("GET", "/api/terminals/t1")).body).toMatchObject({ title: "notes" });
    expect(
      (await send("PATCH", "/api/terminals/t1", { origin: true, body: { title: 4 } })).status,
    ).toBe(400);
    expect(
      (await send("PATCH", "/api/terminals/t1", { token: false, body: { title: "x" } })).status,
    ).toBe(403);
    expect((await send("PATCH", "/api/terminals/t9", { body: { title: "x" } })).status).toBe(404);
  });

  it("refuse writes without the token", async () => {
    const reply = await send("POST", "/api/terminals", {
      token: false,
      body: { cwd: scratch, command: "ls" },
    });
    expect(reply.status).toBe(403);
    expect(children).toHaveLength(0);
  });

  it("stream the kept output first, then live output, with the token in the query", async () => {
    await send("POST", "/api/terminals", { body: { cwd: scratch, command: "cat" } });
    children[0]?.emit("one ");
    const refused = openStream("/api/terminals/t1/stream");
    await vi.waitFor(() => expect(refused.status()).toBe(403));
    refused.close();

    const stream = openStream(`/api/terminals/t1/stream?from=0&token=${TOKEN}`);
    await vi.waitFor(() => expect(stream.events).toHaveLength(2));
    expect(stream.events[0]).toEqual({ event: "output", data: { seq: 0, data: "one " } });
    expect(stream.events[1]).toMatchObject({ event: "status", data: { id: "t1" } });
    children[0]?.emit("two");
    await vi.waitFor(() => expect(stream.events).toHaveLength(3));
    expect(stream.events[2]).toEqual({ event: "output", data: { seq: 4, data: "two" } });
    stream.close();
  });

  it("stream the list of terminals as it changes", async () => {
    const stream = openStream(`/api/terminals/events?token=${TOKEN}`);
    await vi.waitFor(() => expect(stream.events).toHaveLength(1));
    expect(stream.events[0]).toEqual({ event: "terminals", data: { terminals: [] } });
    await send("POST", "/api/terminals", { body: { cwd: scratch, command: "cat" } });
    await vi.waitFor(() => expect(stream.events).toHaveLength(2));
    expect(stream.events[1]).toMatchObject({ data: { terminals: [{ id: "t1" }] } });
    stream.close();
  });
});

describe("focus", () => {
  it("opens the page link in the browser when no page is open", async () => {
    await send("POST", "/api/terminals", { body: { cwd: scratch, command: "cat" } });
    const reply = await send("POST", "/api/focus", { body: { target: "t1" } });
    expect(reply).toMatchObject({
      status: 200,
      body: { target: { terminal: "t1" }, pages: 0, focused: false, opened: true },
    });
    expect(opened).toEqual(["http://localhost:4949/?terminal=t1"]);
  });

  it("asks open pages first and opens nothing when one comes forward", async () => {
    const page = openStream("/api/events");
    await vi.waitFor(() => expect(page.events.length).toBeGreaterThan(0));
    const focusing = send("POST", "/api/focus", { body: { target: "web.shop" } });
    await vi.waitFor(() => expect(page.events.some((item) => item.event === "focus")).toBe(true));
    const event = page.events.find((item) => item.event === "focus")?.data as {
      id: string;
      target: unknown;
    };
    expect(event.target).toEqual({ route: "web.shop" });
    await send("POST", "/api/focus/ack", { body: { id: event.id, focused: true } });
    expect(await focusing).toMatchObject({
      status: 200,
      body: { pages: 1, focused: true, opened: false },
    });
    expect(opened).toEqual([]);
    page.close();
  });

  it("opens the link when the page could not come forward", async () => {
    const page = openStream("/api/events");
    await vi.waitFor(() => expect(page.events.length).toBeGreaterThan(0));
    const focusing = send("POST", "/api/focus", { body: { target: "port:3000" } });
    await vi.waitFor(() => expect(page.events.some((item) => item.event === "focus")).toBe(true));
    const event = page.events.find((item) => item.event === "focus")?.data as { id: string };
    await send("POST", "/api/focus/ack", { body: { id: event.id, focused: false } });
    expect(await focusing).toMatchObject({ body: { focused: false, opened: true } });
    expect(opened).toEqual(["http://localhost:4949/?focus=port%3A3000"]);
    page.close();
  });

  it("says when the target is unknown and needs the token", async () => {
    expect(await send("POST", "/api/focus", { body: { target: "ghost" } })).toMatchObject({
      status: 404,
      body: { error: "not_found" },
    });
    expect((await send("POST", "/api/focus", { token: false, body: {} })).status).toBe(403);
  });
});
