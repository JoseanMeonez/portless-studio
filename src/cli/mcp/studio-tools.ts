import {
  API_PATHS,
  type ConfigResponse,
  type CreateAliasRequest,
  type CreateTerminalRequest,
  type DoctorReport,
  type FocusResponse,
  type ProxyAction,
  type ProxyActionResponse,
  type Snapshot,
  type TerminalOutputResponse,
  type TerminalsResponse,
} from "../../core/api/contract.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { plainText, type TerminalInfo } from "../../core/terminals/terminal.ts";
import { describeProxy, detectedItem, proxyItem, routeItem } from "../studio-items.ts";
import type { McpTool, ToolResult } from "./mcp-server.ts";
import type { StudioClient, StudioClientError } from "./studio-client.ts";

const NAMING_HINT =
  "Make each name say what the work is: start it with the ticket key, PR number or a short task " +
  "name (ed-1234.web.myapp, pr-87.web.myapp, dark-mode.web.myapp), so two worktrees of the same " +
  "repository are told apart. The suggested name already does this when the branch has a ticket key.";

/** Sent on initialize, so agents know how Studio fits the way they run dev servers. */
export const AGENT_INSTRUCTIONS = [
  "Portless Studio gives local dev servers stable names like http://web.myapp.localhost:1355.",
  "Name, rename and remove routes through these tools, not by editing portless files, so the",
  "Studio dashboard updates at once. After starting a dev server, call list_detected_ports and",
  "name_port (or name_all_detected). To see which ports a worktree uses, call list_routes and",
  "list_detected_ports and filter by the worktree field. Ask the user before stop_server.",
  "Start dev servers with run_in_terminal (or `portless-studio run -- <command>` in a shell) instead",
  "of in your own shell, so the user can watch their output in Studio; read it with read_terminal.",
  "When the user asks to see something, call focus_studio.",
  NAMING_HINT,
].join(" ");

const PROXY_ACTIONS: readonly ProxyAction[] = ["start", "stop", "restart"];

const NAME_SCHEMA = {
  type: "string",
  description: "Route name without the .localhost suffix, e.g. web.myapp",
};
const PORT_SCHEMA = { type: "integer", minimum: 1, maximum: 65535 };
const NO_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;
const TERMINAL_ID_SCHEMA = {
  type: "string",
  description: "Terminal id from list_terminals, e.g. t3",
};
const DEFAULT_READ_CHARS = 16_000;
const MAX_READ_CHARS = 200_000;

export function createStudioTools(client: StudioClient): McpTool[] {
  return [
    {
      name: "list_routes",
      title: "List named routes",
      description:
        "Lists every portless route Studio knows: name, browser URL, local port, kind (app or alias), " +
        "health (up, error, down), project and git worktree it runs from, and pid. Use it to find the " +
        "URL of a running app or which ports a worktree uses.",
      inputSchema: NO_INPUT,
      call: async () => {
        const snapshot = await readSnapshot(client);
        if (!snapshot.ok) return snapshot.error;
        const { routes, proxy } = snapshot.value;
        const up = routes.filter((route) => route.health?.state === "up").length;
        return {
          summary: `${plural(routes.length, "route")} (${up} up); ${describeProxy(proxy)}.`,
          data: { proxy: proxyItem(proxy), routes: routes.map(routeItem) },
        };
      },
    },
    {
      name: "list_detected_ports",
      title: "List ports without a name",
      description:
        "Lists dev servers listening on this machine that answer HTTP and have no portless name yet: " +
        "port, pid, process, working folder, project, worktree and the name Studio suggests. Call it " +
        "after starting a dev server, then name the port with name_port.",
      inputSchema: NO_INPUT,
      call: async () => {
        const snapshot = await readSnapshot(client);
        if (!snapshot.ok) return snapshot.error;
        const { detected } = snapshot.value;
        const suggested = detected.filter((port) => port.suggestedName !== null).length;
        return {
          summary: `${plural(detected.length, "port")} without a name; ${suggested} ${suggested === 1 ? "has" : "have"} a suggested name.`,
          data: detected.map(detectedItem),
        };
      },
    },
    {
      name: "name_port",
      title: "Name a port",
      description:
        "Gives a local port a stable name, so it opens at http://<name>.localhost through the portless " +
        "proxy. Creates a portless alias; the Studio dashboard shows it immediately. Set replace to " +
        "true to move an existing name to this port. " +
        NAMING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          port: { ...PORT_SCHEMA, description: "Local port the dev server listens on" },
          name: NAME_SCHEMA,
          replace: { type: "boolean", description: "Replace a route that already has this name" },
        },
        required: ["port", "name"],
        additionalProperties: false,
      },
      call: async (args) => {
        const port = readPort(args, "port");
        const name = readString(args, "name");
        if (!port.ok) return invalid(port.error);
        if (!name.ok) return invalid(name.error);
        const named = await nameOne(client, port.value, name.value, args.replace === true);
        if (!named.ok) return named.error;
        const snapshot = await readSnapshot(client);
        const url = snapshot.ok
          ? snapshot.value.routes.find((route) => route.name === name.value)?.url
          : undefined;
        return { summary: `Port ${port.value} is now "${name.value}"${url ? `: ${url}` : "."}` };
      },
    },
    {
      name: "rename_route",
      title: "Rename a route",
      description:
        "Renames a route that was named by hand (an alias). The URL changes to the new name; the " +
        "dashboard updates immediately. Routes portless started itself (kind app) cannot be renamed. " +
        NAMING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          name: { ...NAME_SCHEMA, description: "Current route name" },
          new_name: { ...NAME_SCHEMA, description: "New route name, e.g. web.myapp" },
        },
        required: ["name", "new_name"],
        additionalProperties: false,
      },
      call: async (args) => {
        const name = readString(args, "name");
        const newName = readString(args, "new_name");
        if (!name.ok) return invalid(name.error);
        if (!newName.ok) return invalid(newName.error);
        const result = await client.write("PATCH", API_PATHS.alias(name.value), {
          name: newName.value,
        });
        if (!result.ok) return failure(result.error);
        return { summary: `Renamed "${name.value}" to "${newName.value}".` };
      },
    },
    {
      name: "remove_route",
      title: "Remove a route",
      description:
        "Removes a name given by hand (an alias). The dev server keeps running; only the name goes " +
        "away and its port shows up again in list_detected_ports.",
      inputSchema: {
        type: "object",
        properties: { name: NAME_SCHEMA },
        required: ["name"],
        additionalProperties: false,
      },
      call: async (args) => {
        const name = readString(args, "name");
        if (!name.ok) return invalid(name.error);
        const result = await client.write("DELETE", API_PATHS.alias(name.value));
        if (!result.ok) return failure(result.error);
        return { summary: `Removed "${name.value}".` };
      },
    },
    {
      name: "name_all_detected",
      title: "Name every detected port",
      description:
        "Names every detected port that has a suggested name, using that suggestion. Returns the " +
        "result per port; ports without a suggestion are left alone.",
      inputSchema: NO_INPUT,
      call: async () => {
        const snapshot = await readSnapshot(client);
        if (!snapshot.ok) return snapshot.error;
        const candidates = snapshot.value.detected.flatMap((port) =>
          port.suggestedName === null ? [] : [{ port: port.port, name: port.suggestedName }],
        );
        if (candidates.length === 0) return { summary: "No detected port has a suggested name." };
        const results = [];
        for (const candidate of candidates) {
          const named = await nameOne(client, candidate.port, candidate.name, false);
          results.push(
            named.ok
              ? { ...candidate, ok: true }
              : { ...candidate, ok: false, error: named.error.summary },
          );
        }
        const done = results.filter((result) => result.ok).length;
        return {
          summary: `Named ${done} of ${candidates.length} detected ports with a suggested name.`,
          data: results,
        };
      },
    },
    {
      name: "stop_server",
      title: "Stop a dev server",
      description:
        "Stops the dev server process behind a port or pid (only the current user's processes that " +
        "listen on a detected or named port). It ends that process, so ask the user first and pass " +
        "confirm: true. Give either pid or port.",
      inputSchema: {
        type: "object",
        properties: {
          pid: { type: "integer", minimum: 1, description: "Process id to stop" },
          port: { ...PORT_SCHEMA, description: "Stop the process listening on this port" },
          confirm: {
            type: "boolean",
            const: true,
            description: "Must be true: the user agreed to stop the process",
          },
        },
        required: ["confirm"],
        additionalProperties: false,
      },
      call: async (args) => {
        if (args.confirm !== true) {
          return invalid(
            "stop_server needs confirm: true. Ask the user before stopping a dev server; it ends the process.",
          );
        }
        const target = await resolvePid(client, args);
        if (!target.ok) return target.error;
        const { pid, port } = target.value;
        const result = await client.write("POST", API_PATHS.stopProcess(pid));
        if (!result.ok) return failure(result.error);
        return { summary: `Stopped process ${pid}${port === null ? "" : ` (port ${port})`}.` };
      },
    },
    {
      name: "doctor",
      title: "Check the setup",
      description:
        "Runs Studio's health checks: portless installed, the proxy running and owned by the user, " +
        "certificates, ports in use. Each problem comes with the command that fixes it.",
      inputSchema: NO_INPUT,
      call: async () => {
        const report = await client.read(API_PATHS.doctor);
        if (!report.ok) return failure(report.error);
        const checks = (report.value as DoctorReport).checks ?? [];
        const failing = checks.filter((check) => check.status === "fail").length;
        const warnings = checks.filter((check) => check.status === "warn").length;
        return {
          summary: `${plural(checks.length, "check")}: ${failing} failing, ${plural(warnings, "warning")}.`,
          data: checks,
        };
      },
    },
    {
      name: "proxy",
      title: "Start, stop or restart the proxy",
      description:
        "Starts, stops or restarts the portless proxy that serves the *.localhost names. While it is " +
        "stopped, no named URL opens.",
      inputSchema: {
        type: "object",
        properties: { action: { type: "string", enum: PROXY_ACTIONS } },
        required: ["action"],
        additionalProperties: false,
      },
      call: async (args) => {
        const action = PROXY_ACTIONS.find((known) => known === args.action);
        if (!action) return invalid('action must be "start", "stop" or "restart".');
        const result = await client.write("POST", API_PATHS.proxy(action));
        if (!result.ok) return failure(result.error);
        return { summary: (result.value as ProxyActionResponse).message };
      },
    },
    {
      name: "get_config",
      title: "Read the Studio config",
      description:
        "Returns Studio's settings (port, auto naming, proxy port, ignored ports and processes, " +
        "views) and the path of the JSON file they live in.",
      inputSchema: NO_INPUT,
      call: async () => {
        const result = await client.read(API_PATHS.config);
        if (!result.ok) return failure(result.error);
        const config = result.value as ConfigResponse;
        return {
          summary: `Config file ${config.path}; auto naming is ${config.config.autoName ? "on" : "off"}.`,
          data: config,
        };
      },
    },
    {
      name: "set_auto_name",
      title: "Turn auto naming on or off",
      description:
        "When on, Studio names every new dev server it detects with its suggested name, without " +
        "asking. Changes only this setting.",
      inputSchema: {
        type: "object",
        properties: { enabled: { type: "boolean" } },
        required: ["enabled"],
        additionalProperties: false,
      },
      call: async (args) => {
        if (typeof args.enabled !== "boolean") return invalid("enabled must be true or false.");
        const current = await client.read(API_PATHS.config);
        if (!current.ok) return failure(current.error);
        const { config } = current.value as ConfigResponse;
        const result = await client.write("PUT", API_PATHS.config, {
          ...config,
          autoName: args.enabled,
        });
        if (!result.ok) return failure(result.error);
        return { summary: `Auto naming is ${args.enabled ? "on" : "off"}.` };
      },
    },
    ...terminalTools(client),
  ];
}

function terminalTools(client: StudioClient): McpTool[] {
  return [
    {
      name: "run_in_terminal",
      title: "Run a command in a Studio terminal",
      description:
        "Starts a command (a dev server, tests, a build) in a terminal inside Portless Studio, in a " +
        "project folder, so the user can watch its live output in the dashboard. Prefer it over " +
        "running dev servers in your own shell. Give project (a name from list_routes) or cwd (an " +
        "absolute folder). The first new port the command opens in that folder gets a name: the " +
        "one in name, else the suggested one; set name_port to false for commands that are not " +
        "servers. Returns the terminal id; read its output with read_terminal. " +
        NAMING_HINT,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command, e.g. pnpm dev" },
          project: { type: "string", description: "Project name Studio shows" },
          cwd: { type: "string", description: "Absolute folder to run in" },
          name: {
            ...NAME_SCHEMA,
            description: "Name for the port it opens, e.g. ed-1234.web.myapp",
          },
          name_port: { type: "boolean", description: "Name the port it opens (default true)" },
          title: { type: "string", description: "Tab title in Studio" },
        },
        required: ["command"],
        additionalProperties: false,
      },
      call: async (args) => {
        const command = readString(args, "command");
        if (!command.ok) return invalid(command.error);
        const request: CreateTerminalRequest = { command: command.value };
        if (typeof args.cwd === "string" && args.cwd.trim() !== "") request.cwd = args.cwd.trim();
        else if (typeof args.project === "string" && args.project.trim() !== "") {
          request.project = args.project.trim();
        } else return invalid("Give project or cwd.");
        if (typeof args.title === "string") request.title = args.title;
        if (typeof args.name === "string" && args.name.trim() !== "")
          request.name = args.name.trim();
        else if (args.name_port !== false) request.name = true;
        const result = await client.write("POST", API_PATHS.terminals, request);
        if (!result.ok) return failure(result.error);
        const terminal = result.value as TerminalInfo;
        return {
          summary: `Started ${terminal.id} in ${terminal.cwd}: ${terminal.command}. Read its output with read_terminal {"id": "${terminal.id}"}.`,
          data: terminalItem(terminal),
        };
      },
    },
    {
      name: "list_terminals",
      title: "List Studio terminals",
      description:
        "Lists the terminals Studio runs: id, title, folder, command, project, whether it still " +
        "runs, exit code and the port it named.",
      inputSchema: NO_INPUT,
      call: async () => {
        const result = await client.readPrivate(API_PATHS.terminals);
        if (!result.ok) return failure(result.error);
        const { terminals } = result.value as TerminalsResponse;
        const running = terminals.filter((terminal) => terminal.status === "running").length;
        return {
          summary: `${plural(terminals.length, "terminal")} (${running} running).`,
          data: terminals.map(terminalItem),
        };
      },
    },
    {
      name: "read_terminal",
      title: "Read a terminal's output",
      description:
        "Returns a terminal's output as plain text, without color codes. By default the last " +
        `${DEFAULT_READ_CHARS} characters; pass from (the next value of an earlier read) to get only ` +
        "what came after it. Also says whether the command still runs and its exit code.",
      inputSchema: {
        type: "object",
        properties: {
          id: TERMINAL_ID_SCHEMA,
          from: {
            type: "integer",
            minimum: 0,
            description: "Read from this offset (next of an earlier read)",
          },
          max_bytes: {
            type: "integer",
            minimum: 1,
            maximum: MAX_READ_CHARS,
            description: `Most characters to return (default ${DEFAULT_READ_CHARS})`,
          },
        },
        required: ["id"],
        additionalProperties: false,
      },
      call: async (args) => {
        const id = readString(args, "id");
        if (!id.ok) return invalid(id.error);
        const max = Math.min(
          MAX_READ_CHARS,
          Number.isInteger(args.max_bytes) && Number(args.max_bytes) > 0
            ? Number(args.max_bytes)
            : DEFAULT_READ_CHARS,
        );
        let from = Number(args.from);
        if (args.from === undefined || !Number.isInteger(from) || from < 0) {
          const info = await client.readPrivate(API_PATHS.terminal(id.value));
          if (!info.ok) return failure(info.error);
          from = Math.max(0, (info.value as TerminalInfo).nextSeq - max);
        }
        const result = await client.readPrivate(
          `${API_PATHS.terminalOutput(id.value)}?from=${from}&max=${max}`,
        );
        if (!result.ok) return failure(result.error);
        const output = result.value as TerminalOutputResponse;
        const { terminal } = output;
        const state =
          terminal.status === "running"
            ? "is running"
            : `exited with code ${terminal.exitCode ?? "none"}`;
        const more = output.next < terminal.nextSeq ? " More output follows." : "";
        const cut = output.truncated ? " Older output was dropped." : "";
        return {
          summary: `${terminal.id} (${terminal.command || "shell"}) ${state}. Characters ${output.from} to ${output.next}; read again with from ${output.next}.${more}${cut}\n${plainText(output.data)}`,
          data: {
            next: output.next,
            truncated: output.truncated,
            status: terminal.status,
            exit_code: terminal.exitCode,
          },
        };
      },
    },
    {
      name: "send_to_terminal",
      title: "Type into a terminal",
      description:
        "Sends text to a running terminal's command, as if typed. enter (default true) presses " +
        "Enter after it. Use it to answer a prompt or run a command in a shell terminal.",
      inputSchema: {
        type: "object",
        properties: {
          id: TERMINAL_ID_SCHEMA,
          text: { type: "string" },
          enter: { type: "boolean", description: "Press Enter after the text (default true)" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      },
      call: async (args) => {
        const id = readString(args, "id");
        if (!id.ok) return invalid(id.error);
        if (typeof args.text !== "string") return invalid("text must be a string.");
        const text = args.enter === false ? args.text : `${args.text}\r`;
        const result = await client.write("POST", API_PATHS.terminalInput(id.value), { text });
        if (!result.ok) return failure(result.error);
        return { summary: `Sent to ${id.value}. Read the answer with read_terminal.` };
      },
    },
    {
      name: "stop_terminal",
      title: "Stop a terminal's command",
      description:
        "Stops the command running in a terminal: Ctrl+C, then SIGTERM and SIGKILL if it keeps " +
        "running. The terminal and its output stay. Ask the user first and pass confirm: true.",
      inputSchema: {
        type: "object",
        properties: {
          id: TERMINAL_ID_SCHEMA,
          confirm: {
            type: "boolean",
            const: true,
            description: "Must be true: the user agreed to stop it",
          },
        },
        required: ["id", "confirm"],
        additionalProperties: false,
      },
      call: async (args) => {
        if (args.confirm !== true) {
          return invalid("stop_terminal needs confirm: true. Ask the user before stopping it.");
        }
        const id = readString(args, "id");
        if (!id.ok) return invalid(id.error);
        const result = await client.write("POST", API_PATHS.terminalStop(id.value));
        if (!result.ok) return failure(result.error);
        return { summary: `Stopping ${id.value}. list_terminals shows when it has exited.` };
      },
    },
    {
      name: "focus_studio",
      title: "Show something in Studio",
      description:
        "Brings the Studio page to the front of the user's screen showing a route, a project, a " +
        "port (port:5173) or a terminal id; with no target, just Studio. Use it when the user asks " +
        "to see a server, its logs or Studio itself.",
      inputSchema: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Route name, project name, terminal id or port:<n>",
          },
        },
        additionalProperties: false,
      },
      call: async (args) => {
        const target = typeof args.target === "string" ? args.target : undefined;
        const result = await client.write("POST", API_PATHS.focus, target ? { target } : {});
        if (!result.ok) return failure(result.error);
        return { summary: describeFocus(result.value as FocusResponse), data: result.value };
      },
    },
  ];
}

/** One line for the CLI and agents saying how Studio came forward. */
export function describeFocus(focus: FocusResponse): string {
  const what =
    focus.target.terminal !== undefined
      ? `terminal ${focus.target.terminal}`
      : focus.target.route !== undefined
        ? focus.target.route
        : focus.target.port !== undefined
          ? `port ${focus.target.port}`
          : "Studio";
  if (focus.focused) return `Showing ${what} in the open Studio page.`;
  if (focus.opened) return `Opened ${focus.url} in the browser to show ${what}.`;
  return focus.pages > 0
    ? `Showing ${what} in the open Studio page; the browser did not bring it to the front.`
    : `No Studio page is open. Open ${focus.url} to see ${what}.`;
}

function terminalItem(terminal: TerminalInfo) {
  return {
    id: terminal.id,
    title: terminal.title,
    cwd: terminal.cwd,
    command: terminal.command,
    project: terminal.project,
    status: terminal.status,
    exit_code: terminal.exitCode,
    pid: terminal.pid,
    named: terminal.naming?.name ?? null,
    port: terminal.naming?.port ?? null,
  };
}

async function readSnapshot(client: StudioClient): Promise<Result<Snapshot, ToolResult>> {
  const result = await client.read(API_PATHS.snapshot);
  if (!result.ok) return err(failure(result.error));
  return ok(result.value as Snapshot);
}

async function nameOne(
  client: StudioClient,
  port: number,
  name: string,
  force: boolean,
): Promise<Result<void, ToolResult>> {
  const body: CreateAliasRequest = { name, port, force };
  const result = await client.write("POST", API_PATHS.aliases, body);
  return result.ok ? ok(undefined) : err(failure(result.error));
}

async function resolvePid(
  client: StudioClient,
  args: Record<string, unknown>,
): Promise<Result<{ pid: number; port: number | null }, ToolResult>> {
  if (args.pid !== undefined) {
    const pid = Number(args.pid);
    if (!Number.isInteger(pid) || pid < 1) return err(invalid("pid must be a positive integer."));
    return ok({ pid, port: null });
  }
  const port = readPort(args, "port");
  if (!port.ok) return err(invalid("Give a pid or a port."));
  const snapshot = await readSnapshot(client);
  if (!snapshot.ok) return snapshot;
  const route = snapshot.value.routes.find((item) => item.port === port.value);
  const detected = snapshot.value.detected.find((item) => item.port === port.value);
  const pid = route?.listenerPid ?? route?.pid ?? detected?.pid ?? null;
  if (pid === null) {
    return err(invalid(`No process Studio knows listens on port ${port.value}.`));
  }
  return ok({ pid, port: port.value });
}

function readPort(args: Record<string, unknown>, key: string): Result<number, string> {
  const value = Number(args[key]);
  if (args[key] === undefined || !Number.isInteger(value) || value < 1 || value > 65535) {
    return err(`${key} must be a whole number from 1 to 65535.`);
  }
  return ok(value);
}

function readString(args: Record<string, unknown>, key: string): Result<string, string> {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "")
    return err(`${key} must be a non-empty string.`);
  return ok(value.trim());
}

function invalid(message: string): ToolResult {
  return { summary: `Invalid arguments: ${message}`, isError: true };
}

function failure(error: StudioClientError): ToolResult {
  const summary = error.command ? `${error.message} Run instead: ${error.command}` : error.message;
  return { summary, isError: true };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
