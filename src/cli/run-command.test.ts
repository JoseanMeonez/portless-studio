import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { parseCliArgs } from "./cli-args.ts";
import { runOpenCommand } from "./focus-command.ts";
import { createStudioClient } from "./mcp/studio-client.ts";
import { commandLine, runInStudio } from "./run-command.ts";

const TOKEN = "secret";
const INFO = {
  id: "t4",
  title: "pnpm dev",
  cwd: "/work/shop",
  command: "pnpm dev",
  project: "shop",
  status: "running",
  exitCode: null,
  startedAt: 1,
  endedAt: null,
  pid: 9,
  mode: "pty",
  cols: 80,
  rows: 24,
  nextSeq: 0,
  naming: { state: "waiting", requested: null, name: null, port: null },
};

type Recorded = { method: string; url: string; body: string; token: string | undefined };

let server: Server;
let requests: Recorded[];
let stream: ServerResponse | null;
let onStream: (res: ServerResponse) => void;

function event(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

beforeEach(async () => {
  requests = [];
  stream = null;
  onStream = () => {};
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      const token = req.headers["x-portless-studio-token"] as string | undefined;
      requests.push({ method: req.method ?? "", url: req.url ?? "", body, token });
      res.setHeader("x-portless-studio", "1");
      if (req.url === "/api/session") {
        res.writeHead(200).end(JSON.stringify({ token: TOKEN }));
      } else if (req.url === "/api/terminals" && req.method === "POST") {
        res.writeHead(201).end(JSON.stringify(INFO));
      } else if (req.url?.startsWith("/api/terminals/t4/stream")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        stream = res;
        onStream(res);
      } else if (req.url === "/api/focus") {
        res.writeHead(200).end(
          JSON.stringify({
            target: { route: "web.shop" },
            pages: 1,
            focused: true,
            opened: false,
            url: "http://localhost:4949/?focus=web.shop",
          }),
        );
      } else {
        res.writeHead(200).end(JSON.stringify(INFO));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function baseUrl(): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function run(interrupts: (() => void)[] = []) {
  const output: string[] = [];
  const notes: string[] = [];
  const done = runInStudio({
    client: createStudioClient(baseUrl()),
    cwd: "/work/shop",
    argv: ["pnpm", "dev"],
    name: null,
    platform: "linux",
    columns: 100,
    rows: 40,
    write: (text) => output.push(text),
    note: (line) => notes.push(line),
    onInterrupt: (handler) => interrupts.push(handler),
  });
  return { done, output, notes };
}

describe("portless-studio run", () => {
  it("starts the command in a Studio terminal and prints its output until it exits", async () => {
    onStream = (res) => {
      res.write(event("output", { seq: 0, data: "\u001b[32mready\u001b[0m\r\n" }));
      res.write(event("status", INFO));
      res.write(
        event("status", {
          ...INFO,
          naming: { state: "named", requested: null, name: "web.shop", port: 5173 },
        }),
      );
      res.write(event("status", { ...INFO, status: "exited", exitCode: 3 }));
    };
    const { done, output, notes } = run();
    expect(await done).toBe(3);
    expect(output).toEqual(["\u001b[32mready\u001b[0m\r\n"]);
    expect(notes).toEqual([
      `portless-studio: running in Studio terminal t4; watch it at ${baseUrl()}/?terminal=t4`,
      'portless-studio: port 5173 is now "web.shop"',
    ]);
    const created = requests.find((request) => request.url === "/api/terminals");
    expect(created?.token).toBe(TOKEN);
    expect(JSON.parse(created?.body ?? "{}")).toEqual({
      cwd: "/work/shop",
      command: "pnpm dev",
      name: true,
      cols: 100,
      rows: 40,
    });
    const streamed = requests.find((request) => request.url.includes("/stream"));
    expect(streamed).toMatchObject({ url: "/api/terminals/t4/stream?from=0", token: TOKEN });
  });

  it("stops the command on Ctrl+C and exits with 130 once it ended", async () => {
    const interrupts: (() => void)[] = [];
    const { done } = run(interrupts);
    await vi.waitFor(() => expect(stream).not.toBeNull());
    interrupts[0]?.();
    await vi.waitFor(() =>
      expect(requests.some((request) => request.url === "/api/terminals/t4/stop")).toBe(true),
    );
    stream?.write(event("status", { ...INFO, status: "exited", exitCode: null }));
    expect(await done).toBe(130);
  });

  it("says so and fails when Studio is not running", async () => {
    const url = baseUrl();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const notes: string[] = [];
    const code = await runInStudio({
      client: createStudioClient(url),
      cwd: "/work/shop",
      argv: ["pnpm", "dev"],
      name: "pr-7.shop",
      platform: "linux",
      write: () => {},
      note: (line) => notes.push(line),
      onInterrupt: () => {},
    });
    expect(code).toBe(1);
    expect(notes[0]).toContain("Portless Studio is not running");
  });
});

describe("portless-studio open", () => {
  it("asks Studio to show the target and prints how", async () => {
    const lines: string[] = [];
    const code = await runOpenCommand(
      createStudioClient(baseUrl()),
      "web.shop",
      (line) => lines.push(line),
      () => {},
    );
    expect(code).toBe(0);
    expect(lines).toEqual(["Showing web.shop in the open Studio page."]);
    expect(JSON.parse(requests.at(-1)?.body ?? "{}")).toEqual({ target: "web.shop" });
  });
});

describe("commandLine", () => {
  it("keeps one word as written and quotes words that need it", () => {
    expect(commandLine(["pnpm dev && pnpm test"], "linux")).toBe("pnpm dev && pnpm test");
    expect(commandLine(["pnpm", "dev", "--port", "3000"], "linux")).toBe("pnpm dev --port 3000");
    expect(commandLine(["sh", "-c", "echo it's"], "linux")).toBe(`sh -c 'echo it'\\''s'`);
    expect(commandLine(["node", "my app.js"], "win32")).toBe('node "my app.js"');
  });
});

describe("parseCliArgs for run and open", () => {
  it("reads the command after --, the name and the folder", () => {
    expect(
      parseCliArgs([
        "run",
        "--name",
        "pr-7.shop",
        "--cwd",
        "/work/shop",
        "--",
        "pnpm",
        "dev",
        "-p",
        "3",
      ]),
    ).toEqual({
      ok: true,
      value: {
        command: "run",
        cwd: "/work/shop",
        name: "pr-7.shop",
        argv: ["pnpm", "dev", "-p", "3"],
      },
    });
    expect(parseCliArgs(["run"])).toMatchObject({ ok: false });
    expect(parseCliArgs(["run", "--name", " ", "--", "x"])).toMatchObject({ ok: false });
  });

  it("reads an optional target for open", () => {
    expect(parseCliArgs(["open"])).toEqual({ ok: true, value: { command: "open", target: null } });
    expect(parseCliArgs(["open", "t2"])).toEqual({
      ok: true,
      value: { command: "open", target: "t2" },
    });
    expect(parseCliArgs(["open", "a", "b"])).toMatchObject({ ok: false });
  });
});
