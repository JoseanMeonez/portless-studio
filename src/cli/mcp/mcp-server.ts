import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/**
 * A Model Context Protocol server over stdio, written by hand to keep Studio free of runtime
 * dependencies: JSON-RPC 2.0, one message per line, only the methods a tools-only server needs.
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18
 */

export const PROTOCOL_VERSION = "2025-06-18";
const KNOWN_VERSIONS = new Set([PROTOCOL_VERSION, "2025-03-26", "2024-11-05"]);

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** What a tool hands back: one line an agent can read, plus the data as compact JSON. */
export type ToolResult = {
  summary: string;
  data?: unknown;
  isError?: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  /** Written for an agent: when to use the tool and what it changes. */
  description: string;
  inputSchema: JsonSchema;
  call(args: Record<string, unknown>): Promise<ToolResult>;
};

export type McpServerOptions = {
  name: string;
  version: string;
  /** Sent on initialize; clients may add it to the agent's context. */
  instructions?: string;
  tools: readonly McpTool[];
};

export type McpServer = {
  /** Handles one line; returns the line to send back, or null when there is no answer. */
  handle(line: string): Promise<string | null>;
};

type RequestId = string | number;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export function createMcpServer(options: McpServerOptions): McpServer {
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));

  async function handle(line: string): Promise<string | null> {
    if (line.trim() === "") return null;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return failure(null, PARSE_ERROR, "Parse error: the message is not valid JSON.");
    }
    if (!isRecord(message)) {
      // Batches were removed from the protocol in 2025-06-18.
      return failure(null, INVALID_REQUEST, "Invalid request: send one JSON-RPC object per line.");
    }
    const id = isRequestId(message.id) ? message.id : null;
    if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      // A response to something we never sent; nothing to answer.
      if (message.jsonrpc === "2.0" && ("result" in message || "error" in message)) return null;
      return failure(id, INVALID_REQUEST, 'Invalid request: needs jsonrpc "2.0" and a method.');
    }
    // Notifications (no id) never get an answer, known or not.
    if (!("id" in message)) return null;
    if (id === null) return failure(null, INVALID_REQUEST, "Invalid request: bad id.");

    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case "initialize":
        return success(id, initializeResult(params));
      case "ping":
        return success(id, {});
      case "tools/list":
        return success(id, {
          tools: options.tools.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
          })),
        });
      case "tools/call":
        return callTool(id, params);
      default:
        return failure(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
    }
  }

  function initializeResult(params: Record<string, unknown>) {
    const asked = params.protocolVersion;
    return {
      protocolVersion:
        typeof asked === "string" && KNOWN_VERSIONS.has(asked) ? asked : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: options.name, version: options.version },
      ...(options.instructions ? { instructions: options.instructions } : {}),
    };
  }

  async function callTool(id: RequestId, params: Record<string, unknown>) {
    const tool = typeof params.name === "string" ? tools.get(params.name) : undefined;
    if (!tool) return failure(id, INVALID_PARAMS, `Unknown tool: ${String(params.name)}`);
    const args = params.arguments ?? {};
    if (!isRecord(args)) {
      return failure(id, INVALID_PARAMS, "Invalid params: arguments must be an object.");
    }
    let result: ToolResult;
    try {
      result = await tool.call(args);
    } catch (error) {
      result = {
        summary: `The tool failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
    const text =
      result.data === undefined
        ? result.summary
        : `${result.summary}\n${JSON.stringify(result.data)}`;
    return success(id, { content: [{ type: "text", text }], isError: result.isError === true });
  }

  return { handle };
}

/**
 * Reads messages from `input` until it ends and writes each answer as one line to `output`.
 * Requests run concurrently, so a slow tool does not hold up a ping. Resolves once every answer is
 * written.
 */
export async function serveStdio(
  server: McpServer,
  input: Readable,
  output: Writable,
): Promise<void> {
  const pending = new Set<Promise<void>>();
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of lines) {
    const task = server.handle(line).then((answer) => {
      if (answer !== null) output.write(`${answer}\n`);
    });
    pending.add(task);
    void task.finally(() => pending.delete(task));
  }
  await Promise.all(pending);
}

function success(id: RequestId, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}

function failure(id: RequestId | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}
