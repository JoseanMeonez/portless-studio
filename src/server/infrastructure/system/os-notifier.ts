import type { StudioEvent } from "../../../core/api/contract.ts";
import type { SystemNotifier } from "../../application/system-notifier.ts";
import { execute } from "../portless/portless-cli.ts";

/** Starts a command and resolves when it ends; `missing` when it is not installed. */
export type NotifierRun = (
  bin: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<{ exitCode: number | null; stdout: string; missing: boolean }>;

/** Whether this machine can show OS notifications, for the doctor. */
export type NotifierAvailability = "available" | "missing" | "unsupported";

export type NotificationCommand = {
  bin: string;
  args: string[];
  /** notify-send with an action waits for the click and prints the action's name. */
  waitsForClick: boolean;
};

const APP_NAME = "portless studio";
/** How long a Linux notification may wait for its Open click before we stop listening. */
const CLICK_WAIT_MS = 10 * 60_000;
const COMMAND_TIMEOUT_MS = 15_000;
/** PowerShell's own app id: a toast needs a registered app, and this one is always there. */
const POWERSHELL_APP_ID =
  "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

/**
 * The command that shows `event` on this system. Linux: `notify-send`, whose Open action we
 * follow with `xdg-open`. macOS: `osascript`, which cannot react to a click, so it only informs.
 * Windows: a PowerShell toast whose click opens `url` (best effort: it needs the Windows
 * Runtime types that Windows PowerShell 5 ships with).
 */
export function notificationCommand(
  platform: NodeJS.Platform,
  event: StudioEvent,
  url: string,
  linux: { actions: boolean },
): NotificationCommand | null {
  if (platform === "linux") {
    const action = linux.actions ? ["--action=open=Open"] : [];
    return {
      bin: "notify-send",
      // `--` keeps a title that starts with a dash from being read as an option.
      args: [`--app-name=${APP_NAME}`, ...action, "--", event.title, event.body],
      waitsForClick: linux.actions,
    };
  }
  if (platform === "darwin") {
    const script = `display notification ${appleString(event.body)} with title ${appleString(APP_NAME)} subtitle ${appleString(event.title)}`;
    return { bin: "osascript", args: ["-e", script], waitsForClick: false };
  }
  if (platform === "win32") {
    const encoded = Buffer.from(toastScript(event, url), "utf16le").toString("base64");
    return {
      bin: "powershell",
      // An encoded script needs no quoting, so cmd.exe has nothing to interpret.
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encoded,
      ],
      waitsForClick: false,
    };
  }
  return null;
}

export type OsNotifierOptions = {
  platform: NodeJS.Platform;
  /** Built on `execute` by default; tests pass a fake so no notification is ever shown. */
  run?: NotifierRun;
};

/** `SystemNotifier` with the tools each system ships with. Nothing to install, nothing to block. */
export class OsNotifier implements SystemNotifier {
  readonly #platform: NodeJS.Platform;
  readonly #run: NotifierRun;
  #linux: Promise<{ installed: boolean; actions: boolean }> | null = null;

  constructor(options: OsNotifierOptions) {
    this.#platform = options.platform;
    this.#run = options.run ?? runWithExecute;
  }

  notify(event: StudioEvent, url: string): void {
    void this.send(event, url).catch(() => {});
  }

  /** Shows the notification and, on Linux, opens `url` when its Open action is clicked. */
  async send(event: StudioEvent, url: string): Promise<void> {
    const linux = this.#platform === "linux" ? await this.#linuxSupport() : { actions: false };
    if ("installed" in linux && !linux.installed) return;
    const command = notificationCommand(this.#platform, event, url, linux);
    if (!command) return;
    const timeoutMs = command.waitsForClick ? CLICK_WAIT_MS : COMMAND_TIMEOUT_MS;
    const outcome = await this.#run(command.bin, command.args, { timeoutMs });
    if (command.waitsForClick && outcome.stdout.trim() === "open") {
      await this.#run("xdg-open", [url], { timeoutMs: COMMAND_TIMEOUT_MS });
    }
  }

  async availability(): Promise<NotifierAvailability> {
    if (this.#platform === "linux") {
      return (await this.#linuxSupport()).installed ? "available" : "missing";
    }
    return this.#platform === "darwin" || this.#platform === "win32" ? "available" : "unsupported";
  }

  /** Asks `notify-send --help` once whether it is installed and knows `--action` (libnotify 0.7.10+). */
  #linuxSupport(): Promise<{ installed: boolean; actions: boolean }> {
    this.#linux ??= this.#run("notify-send", ["--help"], { timeoutMs: COMMAND_TIMEOUT_MS }).then(
      (outcome) => ({
        installed: !outcome.missing,
        actions: !outcome.missing && outcome.stdout.includes("--action"),
      }),
      () => ({ installed: false, actions: false }),
    );
    return this.#linux;
  }
}

async function runWithExecute(
  bin: string,
  args: string[],
  options: { timeoutMs: number },
): Promise<{ exitCode: number | null; stdout: string; missing: boolean }> {
  const outcome = await execute(bin, args, { timeoutMs: options.timeoutMs });
  return { exitCode: outcome.exitCode, stdout: outcome.stdout, missing: outcome.missing };
}

/** An AppleScript string literal. */
function appleString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function xmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toastScript(event: StudioEvent, url: string): string {
  const xml =
    `<toast activationType="protocol" launch="${xmlText(url)}">` +
    `<visual><binding template="ToastGeneric"><text>${xmlText(event.title)}</text>` +
    `<text>${xmlText(event.body)}</text></binding></visual></toast>`;
  // Inside a PowerShell single-quoted string only a single quote needs doubling.
  const quoted = (text: string) => `'${text.replace(/'/g, "''")}'`;
  return [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$xml.LoadXml(${quoted(xml)})`,
    "$toast = New-Object Windows.UI.Notifications.ToastNotification $xml",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${quoted(POWERSHELL_APP_ID)}).Show($toast)`,
  ].join("\n");
}
