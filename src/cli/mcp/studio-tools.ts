import {
  API_PATHS,
  type ConfigResponse,
  type CreateAliasRequest,
  type DoctorReport,
  type ProxyAction,
  type ProxyActionResponse,
  type Snapshot,
} from "../../core/api/contract.ts";
import { err, ok, type Result } from "../../core/result.ts";
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
  NAMING_HINT,
].join(" ");

const PROXY_ACTIONS: readonly ProxyAction[] = ["start", "stop", "restart"];

const NAME_SCHEMA = {
  type: "string",
  description: "Route name without the .localhost suffix, e.g. web.myapp",
};
const PORT_SCHEMA = { type: "integer", minimum: 1, maximum: 65535 };
const NO_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;

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
    // run_server and read_logs come with T17, once Studio can run dev servers and keep their logs.
  ];
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
