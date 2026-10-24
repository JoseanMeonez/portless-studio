import { type DoctorCheck, overallStatus } from "../core/doctor/doctor-check.ts";

const MARKS = { ok: "✓", warn: "!", fail: "✗" } as const;

/** A readable checklist: one line per check, then what was found and the fix for each problem. */
export function formatDoctorReport(checks: readonly DoctorCheck[]): string {
  const lines: string[] = [];
  for (const check of checks) {
    lines.push(`  ${MARKS[check.status]} ${check.title}`);
    if (check.status === "ok") continue;
    lines.push(`      ${check.detail}`);
    if (check.fix?.command) lines.push(`      Fix: ${check.fix.command}`);
    else if (check.fix) lines.push(`      Fix: "${check.fix.label}" in Studio's Health panel`);
  }
  lines.push("", summary(checks));
  return lines.join("\n");
}

/** Prints the report; the exit code is 1 when any check fails, so scripts can rely on it. */
export async function runDoctorCommand(
  check: () => Promise<DoctorCheck[]>,
  print: (line: string) => void,
): Promise<number> {
  const checks = await check();
  print(formatDoctorReport(checks));
  return overallStatus(checks) === "fail" ? 1 : 0;
}

function summary(checks: readonly DoctorCheck[]): string {
  const failures = checks.filter((check) => check.status === "fail").length;
  const warnings = checks.filter((check) => check.status === "warn").length;
  if (failures === 0 && warnings === 0) return "Everything looks good.";
  const parts = [
    failures > 0 ? `${failures} ${failures === 1 ? "problem" : "problems"}` : null,
    warnings > 0 ? `${warnings} ${warnings === 1 ? "warning" : "warnings"}` : null,
  ].filter(Boolean);
  return `${parts.join(" and ")}.`;
}
