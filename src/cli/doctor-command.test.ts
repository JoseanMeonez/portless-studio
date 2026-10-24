import type { DoctorCheck } from "../core/doctor/doctor-check.ts";
import { formatDoctorReport, runDoctorCommand } from "./doctor-command.ts";

const ROOT_PROXY: DoctorCheck = {
  id: "proxy-owner",
  status: "warn",
  title: "The proxy runs as root",
  detail: "It was started with sudo (pid 3694271, port 443).",
  fix: { label: "Stop it once with sudo", command: "sudo portless proxy stop" },
};
const TWO_PROXIES: DoctorCheck = {
  id: "proxy-count",
  status: "fail",
  title: "2 portless proxies are running",
  detail: "Found :443 (root, pid 3694271), :1355 (you, pid 3701892).",
  fix: { label: "Stop every proxy", command: "sudo kill 3694271 3701892" },
};
const PORTLESS: DoctorCheck = {
  id: "portless",
  status: "ok",
  title: "portless 0.15.11 is installed",
  detail: "Studio names ports and starts the proxy through it.",
};
const HTTP: DoctorCheck = {
  id: "https-trust",
  status: "warn",
  title: "Chrome may not trust the HTTPS certificate",
  detail: "certutil is not installed.",
  fix: { label: "Switch to HTTP on port 1355", action: "use-http-1355" },
};

describe("formatDoctorReport", () => {
  it("prints a checklist with the fix under each problem and a summary", () => {
    expect(formatDoctorReport([PORTLESS, ROOT_PROXY, TWO_PROXIES, HTTP])).toBe(
      [
        "  ✓ portless 0.15.11 is installed",
        "  ! The proxy runs as root",
        "      It was started with sudo (pid 3694271, port 443).",
        "      Fix: sudo portless proxy stop",
        "  ✗ 2 portless proxies are running",
        "      Found :443 (root, pid 3694271), :1355 (you, pid 3701892).",
        "      Fix: sudo kill 3694271 3701892",
        "  ! Chrome may not trust the HTTPS certificate",
        "      certutil is not installed.",
        '      Fix: "Switch to HTTP on port 1355" in Studio\'s Health panel',
        "",
        "1 problem and 2 warnings.",
      ].join("\n"),
    );
  });

  it("says everything is fine when it is", () => {
    expect(formatDoctorReport([PORTLESS]).split("\n").at(-1)).toBe("Everything looks good.");
  });
});

describe("runDoctorCommand", () => {
  it("exits with 1 when a check fails", async () => {
    const lines: string[] = [];
    const code = await runDoctorCommand(
      async () => [PORTLESS, TWO_PROXIES],
      (line) => lines.push(line),
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("2 portless proxies are running");
  });

  it("exits with 0 when there are only warnings", async () => {
    expect(
      await runDoctorCommand(
        async () => [PORTLESS, ROOT_PROXY],
        () => {},
      ),
    ).toBe(0);
  });

  it("prints the checks and overall status as JSON with --json, keeping the exit code", async () => {
    const lines: string[] = [];
    const code = await runDoctorCommand(
      async () => [PORTLESS, TWO_PROXIES],
      (line) => lines.push(line),
      { json: true },
    );
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({ status: "fail", checks: [PORTLESS, TWO_PROXIES] });
  });
});
