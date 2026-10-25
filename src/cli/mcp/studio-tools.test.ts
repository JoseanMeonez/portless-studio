import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Snapshot } from "../../core/api/contract.ts";
import { DEFAULT_CONFIG } from "../../core/config/studio-config.ts";
import type { Route } from "../../core/routes/route.ts";
import type { McpTool, ToolResult } from "./mcp-server.ts";
import { createStudioClient } from "./studio-client.ts";
import { createStudioTools } from "./studio-tools.ts";

type Recorded = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
type Reply = { status: number; body?: unknown; studio?: boolean };

const TOKEN = "secret-token";

const ROUTE: Route = {
  hostname: "app.acme.localhost",
  name: "app.acme",
  port: 5173,
  kind: "alias",
  pid: null,
  registeredAt: 1,
  url: "http://app.acme.localhost:1355",
  tunnels: [],
  listenerPid: 4242,
  health: { state: "up", status: 200, latencyMs: 3, checkedAt: 1 },
  project: { name: "acme-monorepo", worktree: "falcon" },
};

const SNAPSHOT: Snapshot = {
  proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
  portless: { installed: true, version: "0.15.11" },
  routes: [ROUTE],
  detected: [
    {
      port: 3000,
      pid: 5151,
      processName: "node",
      cwd: "/home/me/code/shop",
      suggestedName: "shop",
      project: { name: "shop", worktree: null },
    },
    { port: 8080, pid: 6161, processName: "python3", cwd: null, suggestedName: null },
  ],
  autoName: false,
  readAt: 1,
};

let server: Server;
let requests: Recorded[];
let respond: (request: Recorded) => Reply;

function defaultReply(request: Recorded): Reply {
  if (request.url === "/api/session") return { status: 200, body: { token: TOKEN } };
  if (request.url.startsWith("/api/snapshot")) return { status: 200, body: SNAPSHOT };
  if (request.url === "/api/config" && request.method === "GET") {
    return { status: 200, body: { config: DEFAULT_CONFIG, path: "/c/config.json" } };
  }
  if (request.url === "/api/config" && request.method === "PUT") {
    return { status: 200, body: { config: JSON.parse(request.body), path: "/c/config.json" } };
  }
  if (request.url === "/api/doctor") {
    return {
      status: 200,
      body: {
        checks: [
          { id: "portless", status: "ok", title: "portless is installed", detail: "" },
          { id: "proxy", status: "warn", title: "The proxy runs as root", detail: "" },
        ],
      },
    };
  }
  if (request.url.startsWith("/api/proxy/")) {
    return { status: 200, body: { message: "The proxy restarted on port 1355." } };
  }
  if (request.method === "POST" && request.url === "/api/aliases") return { status: 201 };
  return { status: 204 };
}

beforeEach(async () => {
  requests = [];
  respond = defaultReply;
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const recorded = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body };
      requests.push(recorded);
      const reply = respond(recorded);
      if (reply.studio !== false) res.setHeader("x-portless-studio", "1");
      if (reply.body === undefined) {
        res.writeHead(reply.status).end();
        return;
      }
      res
        .writeHead(reply.status, { "Content-Type": "application/json" })
        .end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function tools(): Map<string, McpTool> {
  const { port } = server.address() as AddressInfo;
  const client = createStudioClient(`http://127.0.0.1:${port}`);
  return new Map(createStudioTools(client).map((tool) => [tool.name, tool]));
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const tool = tools().get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.call(args);
}

const writes = () => requests.filter((request) => request.method !== "GET");

describe("studio tools", () => {
  it("offers every tool with an object input schema", () => {
    expect([...tools().keys()]).toEqual([
      "list_routes",
      "list_detected_ports",
      "name_port",
      "rename_route",
      "remove_route",
      "name_all_detected",
      "stop_server",
      "doctor",
      "proxy",
      "get_config",
      "set_auto_name",
      "run_in_terminal",
      "list_terminals",
      "read_terminal",
      "send_to_terminal",
      "stop_terminal",
      "focus_studio",
    ]);
    for (const tool of tools().values()) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it("asks agents for a ticket, PR or task in names so worktrees are told apart", () => {
    for (const name of ["name_port", "rename_route"]) {
      const description = tools().get(name)?.description ?? "";
      expect(description).toMatch(/ticket/i);
      expect(description).toMatch(/PR/);
      expect(description).toMatch(/worktree/i);
    }
  });

  it("list_routes asks for Studio's own route only with include_studio", async () => {
    await call("list_routes", { include_studio: true });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /api/snapshot?includeStudio=1",
    ]);
  });

  it("list_routes returns each route with health, project, worktree and pid", async () => {
    const result = await call("list_routes");
    expect(result.isError).toBeFalsy();
    expect(result.summary).toBe("1 route (1 up); proxy running on port 1355.");
    expect(result.data).toEqual({
      proxy: { running: true, port: 1355 },
      routes: [
        {
          name: "app.acme",
          url: "http://app.acme.localhost:1355",
          port: 5173,
          kind: "alias",
          health: "up",
          project: "acme-monorepo",
          worktree: "falcon",
          pid: 4242,
        },
      ],
    });
    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "GET /api/snapshot",
    ]);
    expect(requests[0]?.headers.host).toBe(`127.0.0.1:${(server.address() as AddressInfo).port}`);
    expect(requests[0]?.headers.origin).toBeUndefined();
  });

  it("list_detected_ports returns process, folder and suggested name", async () => {
    const result = await call("list_detected_ports");
    expect(result.summary).toBe("2 ports without a name; 1 has a suggested name.");
    expect(result.data).toEqual([
      {
        port: 3000,
        pid: 5151,
        process: "node",
        folder: "/home/me/code/shop",
        suggestedName: "shop",
        project: "shop",
        worktree: null,
      },
      {
        port: 8080,
        pid: 6161,
        process: "python3",
        folder: null,
        suggestedName: null,
        project: null,
        worktree: null,
      },
    ]);
  });

  it("name_port posts the alias with the session token", async () => {
    const result = await call("name_port", { port: 5173, name: "app.acme", replace: true });
    expect(result.isError).toBeFalsy();
    expect(result.summary).toBe('Port 5173 is now "app.acme": http://app.acme.localhost:1355');
    const [write] = writes();
    expect(write?.method).toBe("POST");
    expect(write?.url).toBe("/api/aliases");
    expect(write?.headers["x-portless-studio-token"]).toBe(TOKEN);
    expect(JSON.parse(write?.body ?? "")).toEqual({ name: "app.acme", port: 5173, force: true });
  });

  it("name_port refuses bad arguments without calling Studio", async () => {
    const result = await call("name_port", { port: "abc", name: "x" });
    expect(result.isError).toBe(true);
    expect(result.summary).toContain("port");
    expect(requests).toEqual([]);
  });

  it("rename_route patches the alias", async () => {
    const result = await call("rename_route", { name: "app.acme", new_name: "web.acme" });
    expect(result.summary).toBe('Renamed "app.acme" to "web.acme".');
    const [write] = writes();
    expect(write?.method).toBe("PATCH");
    expect(write?.url).toBe("/api/aliases/app.acme");
    expect(write?.headers["x-portless-studio-token"]).toBe(TOKEN);
    expect(JSON.parse(write?.body ?? "")).toEqual({ name: "web.acme" });
  });

  it("remove_route deletes the alias", async () => {
    const result = await call("remove_route", { name: "app.acme" });
    expect(result.summary).toBe('Removed "app.acme".');
    const [write] = writes();
    expect(write?.method).toBe("DELETE");
    expect(write?.url).toBe("/api/aliases/app.acme");
    expect(write?.headers["x-portless-studio-token"]).toBe(TOKEN);
  });

  it("passes Studio's error message and command through", async () => {
    respond = (request) =>
      request.method === "DELETE"
        ? { status: 409, body: { error: "not_an_alias", message: "It is an app.", command: "x" } }
        : defaultReply(request);
    const result = await call("remove_route", { name: "app.acme" });
    expect(result.isError).toBe(true);
    expect(result.summary).toBe("It is an app. Run instead: x");
  });

  it("name_all_detected names every port that has a suggestion", async () => {
    const result = await call("name_all_detected");
    expect(result.summary).toBe("Named 1 of 1 detected ports with a suggested name.");
    expect(result.data).toEqual([{ port: 3000, name: "shop", ok: true }]);
    expect(writes().map((write) => JSON.parse(write.body))).toEqual([
      { name: "shop", port: 3000, force: false },
    ]);
  });

  it("stop_server refuses without confirm: true", async () => {
    const result = await call("stop_server", { pid: 4242 });
    expect(result.isError).toBe(true);
    expect(result.summary).toContain("confirm");
    expect(requests).toEqual([]);
  });

  it("stop_server stops a pid, or the process behind a port", async () => {
    expect((await call("stop_server", { pid: 4242, confirm: true })).summary).toBe(
      "Stopped process 4242.",
    );
    expect((await call("stop_server", { port: 3000, confirm: true })).summary).toBe(
      "Stopped process 5151 (port 3000).",
    );
    expect((await call("stop_server", { port: 5173, confirm: true })).summary).toBe(
      "Stopped process 4242 (port 5173).",
    );
    expect(writes().map((write) => write.url)).toEqual([
      "/api/processes/4242/stop",
      "/api/processes/5151/stop",
      "/api/processes/4242/stop",
    ]);
    expect(writes().every((write) => write.headers["x-portless-studio-token"] === TOKEN)).toBe(
      true,
    );
    const unknown = await call("stop_server", { port: 9999, confirm: true });
    expect(unknown.isError).toBe(true);
  });

  it("doctor returns the checks and counts problems", async () => {
    const result = await call("doctor");
    expect(result.summary).toBe("2 checks: 0 failing, 1 warning.");
    expect(result.data).toHaveLength(2);
  });

  it("proxy posts the action and rejects unknown ones", async () => {
    const result = await call("proxy", { action: "restart" });
    expect(result.summary).toBe("The proxy restarted on port 1355.");
    expect(writes()[0]?.url).toBe("/api/proxy/restart");
    expect(writes()[0]?.headers["x-portless-studio-token"]).toBe(TOKEN);
    expect((await call("proxy", { action: "explode" })).isError).toBe(true);
  });

  it("get_config and set_auto_name read and replace the config", async () => {
    const read = await call("get_config");
    expect(read.summary).toBe("Config file /c/config.json; auto naming is off.");
    expect(read.data).toEqual({ config: DEFAULT_CONFIG, path: "/c/config.json" });

    const set = await call("set_auto_name", { enabled: true });
    expect(set.summary).toBe("Auto naming is on.");
    const [write] = writes();
    expect(write?.method).toBe("PUT");
    expect(write?.url).toBe("/api/config");
    expect(write?.headers["x-portless-studio-token"]).toBe(TOKEN);
    expect(JSON.parse(write?.body ?? "")).toEqual({ ...DEFAULT_CONFIG, autoName: true });
  });

  it("fetches a new token once when Studio restarted and rejects the old one", async () => {
    let sessions = 0;
    respond = (request) => {
      if (request.url === "/api/session") {
        sessions += 1;
        return { status: 200, body: { token: `token-${sessions}` } };
      }
      if (request.method === "DELETE" && request.headers["x-portless-studio-token"] !== "token-2") {
        return { status: 403, body: { error: "forbidden", message: "Missing or wrong token." } };
      }
      return defaultReply(request);
    };
    const tool = tools().get("remove_route");
    expect((await tool?.call({ name: "a" }))?.isError).toBeFalsy();
    expect(sessions).toBe(2);
  });

  it("tells the agent to start Studio when nothing listens", async () => {
    const { port } = server.address() as AddressInfo;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const client = createStudioClient(`http://127.0.0.1:${port}`);
    for (const tool of createStudioTools(client)) {
      const args = {
        port: 3000,
        name: "a",
        new_name: "b",
        pid: 1,
        confirm: true,
        command: "pnpm dev",
        project: "shop",
        id: "t1",
        text: "x",
      };
      const result = await tool.call({ ...args, action: "start", enabled: true });
      expect(result.isError).toBe(true);
      expect(result.summary).toContain("Portless Studio is not running");
      expect(result.summary).toContain("portless-studio");
    }
  });

  it("refuses to talk to a server that is not Studio", async () => {
    respond = () => ({ status: 200, body: { token: TOKEN }, studio: false });
    const result = await call("list_routes");
    expect(result.isError).toBe(true);
    expect(result.summary).toContain("not Portless Studio");
  });
});

const TERMINAL = {
  id: "t3",
  title: "pnpm dev",
  cwd: "/work/shop",
  command: "pnpm dev",
  project: "shop",
  status: "running",
  exitCode: null,
  startedAt: 1,
  endedAt: null,
  pid: 900,
  mode: "pty",
  cols: 120,
  rows: 30,
  nextSeq: 40,
  naming: { state: "named", requested: null, name: "web.shop", port: 5173 },
};

describe("terminal tools", () => {
  beforeEach(() => {
    respond = (request) => {
      if (request.url === "/api/session") return { status: 200, body: { token: TOKEN } };
      if (request.url === "/api/terminals" && request.method === "POST") {
        return { status: 201, body: TERMINAL };
      }
      if (request.url === "/api/terminals") return { status: 200, body: { terminals: [TERMINAL] } };
      if (request.url === "/api/terminals/t3") return { status: 200, body: TERMINAL };
      if (request.url.startsWith("/api/terminals/t3/output")) {
        return {
          status: 200,
          body: {
            terminal: TERMINAL,
            data: "\u001b[32mready\u001b[0m\r\nlistening",
            from: 24,
            next: 40,
            truncated: false,
          },
        };
      }
      if (request.url === "/api/focus") {
        return {
          status: 200,
          body: {
            target: { terminal: "t3" },
            pages: 1,
            focused: false,
            opened: true,
            url: "http://localhost:4949/?terminal=t3",
          },
        };
      }
      return { status: 204 };
    };
  });

  it("run_in_terminal starts the command in a project and names its port", async () => {
    const result = await call("run_in_terminal", { project: "shop", command: "pnpm dev" });
    expect(result.summary).toContain("Started t3 in /work/shop: pnpm dev");
    const post = writes().find((request) => request.url === "/api/terminals");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      command: "pnpm dev",
      project: "shop",
      name: true,
    });
    expect(post?.headers["x-portless-studio-token"]).toBe(TOKEN);
  });

  it("run_in_terminal passes a folder and a name, or skips naming", async () => {
    await call("run_in_terminal", { cwd: "/work/shop", command: "pnpm dev", name: "pr-7.shop" });
    await call("run_in_terminal", { cwd: "/work/shop", command: "pnpm test", name_port: false });
    const bodies = writes().map((request) => JSON.parse(request.body));
    expect(bodies).toEqual([
      { command: "pnpm dev", cwd: "/work/shop", name: "pr-7.shop" },
      { command: "pnpm test", cwd: "/work/shop" },
    ]);
  });

  it("run_in_terminal needs a project or a folder", async () => {
    const result = await call("run_in_terminal", { command: "pnpm dev" });
    expect(result.isError).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it("list_terminals reads with the token", async () => {
    const result = await call("list_terminals");
    expect(result.summary).toBe("1 terminal (1 running).");
    expect(result.data).toEqual([
      expect.objectContaining({ id: "t3", named: "web.shop", port: 5173, status: "running" }),
    ]);
    const list = requests.find((request) => request.url === "/api/terminals");
    expect(list?.headers["x-portless-studio-token"]).toBe(TOKEN);
  });

  it("read_terminal returns plain text and where to read next", async () => {
    const result = await call("read_terminal", { id: "t3", max_bytes: 16 });
    expect(
      requests.some((request) => request.url === "/api/terminals/t3/output?from=24&max=16"),
    ).toBe(true);
    expect(result.summary).toContain("read again with from 40");
    expect(result.summary.endsWith("ready\nlistening")).toBe(true);
    expect(result.data).toEqual({ next: 40, truncated: false, status: "running", exit_code: null });
  });

  it("read_terminal reads from a given offset without asking for the terminal first", async () => {
    await call("read_terminal", { id: "t3", from: 10 });
    expect(requests.map((request) => request.url)).toContain(
      "/api/terminals/t3/output?from=10&max=16000",
    );
    expect(requests.some((request) => request.url === "/api/terminals/t3")).toBe(false);
  });

  it("send_to_terminal types the text and presses Enter unless told not to", async () => {
    await call("send_to_terminal", { id: "t3", text: "y" });
    await call("send_to_terminal", { id: "t3", text: "q", enter: false });
    const bodies = writes().map((request) => [request.url, JSON.parse(request.body)]);
    expect(bodies).toEqual([
      ["/api/terminals/t3/input", { text: "y\r" }],
      ["/api/terminals/t3/input", { text: "q" }],
    ]);
  });

  it("stop_terminal needs confirm: true", async () => {
    expect((await call("stop_terminal", { id: "t3" })).isError).toBe(true);
    expect(writes()).toHaveLength(0);
    await call("stop_terminal", { id: "t3", confirm: true });
    expect(writes().map((request) => request.url)).toEqual(["/api/terminals/t3/stop"]);
  });

  it("focus_studio asks Studio to show the target and says how", async () => {
    const result = await call("focus_studio", { target: "t3" });
    expect(JSON.parse(writes()[0]?.body ?? "{}")).toEqual({ target: "t3" });
    expect(result.summary).toBe(
      "Opened http://localhost:4949/?terminal=t3 in the browser to show terminal t3.",
    );
  });
});
