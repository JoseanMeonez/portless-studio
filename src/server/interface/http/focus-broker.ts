import { randomUUID } from "node:crypto";
import type {
  FocusAck,
  FocusEvent,
  FocusResponse,
  FocusTarget,
  Snapshot,
} from "../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../core/result.ts";
import type { TerminalInfo } from "../../../core/terminals/terminal.ts";
import { type AppError, appError } from "../../application/app-error.ts";

export type FocusBrokerOptions = {
  /** Sends the event to every open Studio page; returns how many got it. */
  send(event: FocusEvent): number;
  /** Opens a link in the default browser, which brings the browser to the front. */
  openUrl?: ((url: string) => void) | undefined;
  /** How long to wait for pages to say whether they came forward. */
  ackTimeoutMs?: number;
};

type Pending = {
  waiting: number;
  resolve(focused: boolean): void;
};

const DEFAULT_ACK_TIMEOUT_MS = 1_500;

/**
 * Brings Studio to the front showing something, for `portless-studio open` and the MCP
 * `focus_studio` tool. Open pages get a `focus` event, show the target and call `window.focus()`,
 * then say whether their window came forward; browsers often refuse that for a background tab.
 * When no page answers yes, Studio opens the page link in the browser instead.
 */
export class FocusBroker {
  readonly #send: (event: FocusEvent) => number;
  readonly #openUrl: ((url: string) => void) | undefined;
  readonly #ackTimeoutMs: number;
  readonly #pending = new Map<string, Pending>();

  constructor(options: FocusBrokerOptions) {
    this.#send = options.send;
    this.#openUrl = options.openUrl;
    this.#ackTimeoutMs = options.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
  }

  async focus(target: FocusTarget, url: string): Promise<FocusResponse> {
    const id = randomUUID();
    const answered = new Promise<boolean>((resolve) => {
      this.#pending.set(id, { waiting: 0, resolve });
    });
    const pages = this.#send({ id, target });
    const pending = this.#pending.get(id);
    if (pending) pending.waiting = pages;
    let focused = false;
    if (pages > 0) {
      const timer = setTimeout(() => this.#settle(id, false), this.#ackTimeoutMs);
      focused = await answered;
      clearTimeout(timer);
    }
    this.#pending.delete(id);
    const opened = !focused && this.#openUrl !== undefined;
    if (opened) this.#openUrl?.(url);
    return { target, pages, focused, opened, url };
  }

  /** A page's answer. Unknown or late ids are ignored. */
  ack(answer: FocusAck): void {
    const pending = this.#pending.get(answer.id);
    if (!pending) return;
    if (answer.focused) {
      this.#settle(answer.id, true);
      return;
    }
    pending.waiting -= 1;
    if (pending.waiting <= 0) this.#settle(answer.id, false);
  }

  #settle(id: string, focused: boolean): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.resolve(focused);
  }
}

/**
 * Turns what a person or agent typed into a target: a terminal id, a route name (with or without
 * `.localhost`), `port:<number>` or a bare port, or a project name (its first route, else its
 * first detected port). Empty means Studio itself.
 */
export function resolveFocusTarget(
  text: string | undefined,
  snapshot: Pick<Snapshot, "routes" | "detected">,
  terminals: readonly TerminalInfo[],
): Result<FocusTarget, AppError> {
  const value = text?.trim() ?? "";
  if (value === "") return ok({});
  const port = /^(?:port:)?(\d{1,5})$/.exec(value)?.[1];
  if (port !== undefined) return ok({ port: Number(port) });
  if (terminals.some((terminal) => terminal.id === value)) return ok({ terminal: value });
  const name = value.replace(/\.localhost$/, "");
  const route = snapshot.routes.find((item) => item.name === name);
  if (route) return ok({ route: route.name });
  const projectRoute = snapshot.routes.find((item) => item.project?.name === value);
  if (projectRoute) return ok({ route: projectRoute.name });
  const projectPort = snapshot.detected.find((item) => item.project?.name === value);
  if (projectPort) return ok({ port: projectPort.port });
  return err(
    appError(
      "not_found",
      `Studio shows no route, project or terminal called "${value}". List them with list_routes or list_terminals.`,
    ),
  );
}

/** The page query that shows a target: `?focus=<route>`, `?focus=port:<n>` or `?terminal=<id>`. */
export function focusQuery(target: FocusTarget): Record<string, string> {
  if (target.terminal !== undefined) return { terminal: target.terminal };
  if (target.route !== undefined) return { focus: target.route };
  if (target.port !== undefined) return { focus: `port:${target.port}` };
  return {};
}
