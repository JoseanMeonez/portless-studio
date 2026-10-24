import type { StudioEvent } from "../../../core/api/contract.ts";
import { type NotifierRun, notificationCommand, OsNotifier } from "./os-notifier.ts";

const event: StudioEvent = {
  id: "r-1",
  kind: "named",
  title: 'Named "app"',
  body: "Port 5173 opens at http://app.localhost:1355",
  target: { route: "app", port: 5173 },
  at: 1,
};
const URL = "http://studio.localhost:1355/?focus=app";

type Call = { bin: string; args: string[]; timeoutMs: number };

function fakeRun(answers: Record<string, { exitCode: number | null; stdout: string }>) {
  const calls: Call[] = [];
  const run: NotifierRun = async (bin, args, options) => {
    calls.push({ bin, args, timeoutMs: options.timeoutMs });
    const key = `${bin} ${args[0] ?? ""}`;
    const answer = answers[key] ?? answers[bin] ?? { exitCode: 0, stdout: "" };
    return { ...answer, missing: answer.exitCode === null };
  };
  return { run, calls };
}

describe("notificationCommand", () => {
  it("uses notify-send on Linux with an Open action when it supports one", () => {
    expect(notificationCommand("linux", event, URL, { actions: true })).toEqual({
      bin: "notify-send",
      args: [
        "--app-name=portless studio",
        "--action=open=Open",
        "--",
        'Named "app"',
        "Port 5173 opens at http://app.localhost:1355",
      ],
      waitsForClick: true,
    });
    expect(notificationCommand("linux", event, URL, { actions: false })).toEqual({
      bin: "notify-send",
      args: [
        "--app-name=portless studio",
        "--",
        'Named "app"',
        "Port 5173 opens at http://app.localhost:1355",
      ],
      waitsForClick: false,
    });
  });

  it("uses osascript on macOS, escaping quotes", () => {
    expect(notificationCommand("darwin", event, URL, { actions: false })).toEqual({
      bin: "osascript",
      args: [
        "-e",
        'display notification "Port 5173 opens at http://app.localhost:1355" with title "portless studio" subtitle "Named \\"app\\""',
      ],
      waitsForClick: false,
    });
  });

  it("uses an encoded PowerShell toast on Windows that opens the Studio URL", () => {
    const command = notificationCommand("win32", event, URL, { actions: false });
    expect(command?.bin).toBe("powershell");
    expect(command?.args.slice(0, 4)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
    ]);
    expect(command?.args[4]).toBe("-EncodedCommand");
    const script = Buffer.from(command?.args[5] ?? "", "base64").toString("utf16le");
    expect(script).toContain(
      `activationType="protocol" launch="http://studio.localhost:1355/?focus=app"`,
    );
    expect(script).toContain("<text>Named &quot;app&quot;</text>");
    expect(script).toContain("ToastNotificationManager");
  });

  it("has nothing for other systems", () => {
    expect(notificationCommand("aix", event, URL, { actions: false })).toBeNull();
  });
});

describe("OsNotifier", () => {
  it("opens the Studio URL with xdg-open when the Open action is clicked", async () => {
    const { run, calls } = fakeRun({
      "notify-send --help": { exitCode: 0, stdout: "  -A, --action=[NAME=]Text..." },
      "notify-send --app-name=portless studio": { exitCode: 0, stdout: "open\n" },
    });
    const notifier = new OsNotifier({ platform: "linux", run });
    await notifier.send(event, URL);
    expect(calls.map((call) => call.bin)).toEqual(["notify-send", "notify-send", "xdg-open"]);
    expect(calls[2]?.args).toEqual([URL]);
    // Waiting for a click must not hit the usual 20 s command timeout.
    expect(calls[1]?.timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("does not open anything when the notification is dismissed", async () => {
    const { run, calls } = fakeRun({
      "notify-send --help": { exitCode: 0, stdout: "--action" },
    });
    await new OsNotifier({ platform: "linux", run }).send(event, URL);
    expect(calls.map((call) => call.bin)).toEqual(["notify-send", "notify-send"]);
  });

  it("skips silently and reports it missing when notify-send is not installed", async () => {
    const { run, calls } = fakeRun({ "notify-send": { exitCode: null, stdout: "" } });
    const notifier = new OsNotifier({ platform: "linux", run });
    await notifier.send(event, URL);
    expect(calls).toHaveLength(1);
    expect(await notifier.availability()).toBe("missing");
    expect(calls).toHaveLength(1);
  });

  it("notify returns at once and never throws", () => {
    const run: NotifierRun = () => Promise.reject(new Error("boom"));
    expect(() => new OsNotifier({ platform: "darwin", run }).notify(event, URL)).not.toThrow();
  });
});
