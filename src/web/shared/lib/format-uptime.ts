const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long something has been up, in the short form a dense list needs: `just now`, `12m`,
 * `2h 5m`, `3d 4h`. Returns `null` when the start time is unknown.
 */
export function formatUptime(since: number | null, now: number): string | null {
  if (since === null) return null;
  const elapsed = Math.max(0, now - since);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) {
    const minutes = Math.floor((elapsed % HOUR) / MINUTE);
    return minutes === 0
      ? `${Math.floor(elapsed / HOUR)}h`
      : `${Math.floor(elapsed / HOUR)}h ${minutes}m`;
  }
  const hours = Math.floor((elapsed % DAY) / HOUR);
  return hours === 0 ? `${Math.floor(elapsed / DAY)}d` : `${Math.floor(elapsed / DAY)}d ${hours}h`;
}
