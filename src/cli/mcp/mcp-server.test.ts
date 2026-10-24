import { PassThrough } from "node:stream";
import { createMcpServer, type McpTool, serveStdio } from "./mcp-server.ts";

const echo: McpTool = {
  name: "echo",
  title: "Echo",
  description: "Returns its text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    additionalProperties: false,
  },
  call: async (args) => ({ summary: `said ${String(args.text)}`, data: { text: args.text } }),
};
const broken: McpTool = {
  name: "broken",
  title: "Broken",
  description: "Always fails.",
  inputSchema: { type: "object", properties: {} },
  call: async () => ({ summary: "Studio is not running.", isError: true }),
};
const throwing: McpTool = {
  name: "throwing",
  title: "Throwing",
  description: "Throws.",
  inputSchema: { type: "object", properties: {} },
  call: async () => {
    throw new Error("boom");
  },
};

const server = createMcpServer({
  name: "portless-studio",
  version: "1.2.3",
  instructions: "Use the tools.",
  tools: [echo, broken, throwing],
});

async function send(message: unknown): Promise<unknown> {
  const line = typeof message === "string" ? message : JSON.stringify(message);
  const answer = await server.handle(line);
  return answer === null ? null : JSON.parse(answer);
}

describe("createMcpServer", () => {
  it("answers initialize with the protocol version, tools capability and server info", async () => {
    expect(
      await send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t" } },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "portless-studio", version: "1.2.3" },
        instructions: "Use the tools.",
      },
    });
  });

  it("offers its own version when the client asks for one it does not know", async () => {
    const answer = (await send({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    })) as { result: { protocolVersion: string } };
    expect(answer.result.protocolVersion).toBe("2025-06-18");
  });

  it("does not answer notifications", async () => {
    expect(await send({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await send({ jsonrpc: "2.0", method: "notifications/whatever" })).toBeNull();
    expect(await send("   ")).toBeNull();
  });

  it("answers ping with an empty result", async () => {
    expect(await send({ jsonrpc: "2.0", id: "p", method: "ping" })).toEqual({
      jsonrpc: "2.0",
      id: "p",
      result: {},
    });
  });

  it("lists tools without their handlers", async () => {
    expect(await send({ jsonrpc: "2.0", id: 3, method: "tools/list" })).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        tools: [echo, broken, throwing].map(({ name, title, description, inputSchema }) => ({
          name,
          title,
          description,
          inputSchema,
        })),
      },
    });
  });

  it("calls a tool and returns a summary line plus compact JSON as text", async () => {
    expect(
      await send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "echo", arguments: { text: "hi" } },
      }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 4,
      result: { content: [{ type: "text", text: 'said hi\n{"text":"hi"}' }], isError: false },
    });
  });

  it("marks tool failures with isError, including thrown errors", async () => {
    expect(
      await send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "broken" } }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { content: [{ type: "text", text: "Studio is not running." }], isError: true },
    });
    expect(
      await send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "throwing" } }),
    ).toEqual({
      jsonrpc: "2.0",
      id: 6,
      result: { content: [{ type: "text", text: "The tool failed: boom" }], isError: true },
    });
  });

  it("rejects an unknown tool and bad arguments with -32602", async () => {
    expect(
      await send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "nope" } }),
    ).toMatchObject({ id: 7, error: { code: -32602, message: "Unknown tool: nope" } });
    expect(
      await send({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "echo", arguments: [1] },
      }),
    ).toMatchObject({ id: 8, error: { code: -32602 } });
  });

  it("answers unknown methods with -32601", async () => {
    expect(await send({ jsonrpc: "2.0", id: 9, method: "resources/list" })).toEqual({
      jsonrpc: "2.0",
      id: 9,
      error: { code: -32601, message: "Method not found: resources/list" },
    });
  });

  it("answers bad JSON with -32700 and malformed requests with -32600", async () => {
    expect(await send("{not json")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error: the message is not valid JSON." },
    });
    expect(await send({ id: 10, method: "ping" })).toMatchObject({
      id: 10,
      error: { code: -32600 },
    });
    expect(await send([{ jsonrpc: "2.0", id: 11, method: "ping" }])).toMatchObject({
      id: null,
      error: { code: -32600 },
    });
  });

  it("ignores responses the client sends back", async () => {
    expect(await send({ jsonrpc: "2.0", id: 12, result: {} })).toBeNull();
  });
});

describe("serveStdio", () => {
  it("reads newline-delimited messages and writes one line per answer", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
    const done = serveStdio(server, input, output);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    input.end(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
    await done;
    const lines = chunks.join("").split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1).map((line) => JSON.parse(line))).toEqual([
      { jsonrpc: "2.0", id: 1, result: {} },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });
});
