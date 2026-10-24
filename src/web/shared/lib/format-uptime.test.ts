import { formatUptime } from "./format-uptime.ts";

const now = Date.UTC(2026, 9, 24, 12, 0, 0);
const ago = (milliseconds: number) => now - milliseconds;

describe("formatUptime", () => {
  it("returns null when the start time is unknown", () => {
    expect(formatUptime(null, now)).toBeNull();
  });

  it("uses the largest two units that matter", () => {
    expect(formatUptime(ago(20_000), now)).toBe("just now");
    expect(formatUptime(ago(12 * 60_000), now)).toBe("12m");
    expect(formatUptime(ago(2 * 3_600_000), now)).toBe("2h");
    expect(formatUptime(ago(2 * 3_600_000 + 5 * 60_000), now)).toBe("2h 5m");
    expect(formatUptime(ago(3 * 86_400_000 + 4 * 3_600_000), now)).toBe("3d 4h");
  });

  it("treats a start time in the future as just now", () => {
    expect(formatUptime(now + 5_000, now)).toBe("just now");
  });
});
