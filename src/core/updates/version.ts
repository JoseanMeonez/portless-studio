/** The command that installs the latest release globally, shown with every update notice. */
export const UPDATE_COMMAND = "npm i -g portless-studio";

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Compares two semver versions: negative when `a` is older, positive when newer, 0 when equal.
 * A prerelease sorts before its release. Returns null when either is not a version.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = VERSION.exec(a.trim());
  const right = VERSION.exec(b.trim());
  if (!left || !right) return null;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(left[index]) - Number(right[index]);
    if (difference !== 0) return Math.sign(difference);
  }
  return comparePrereleases(left[4], right[4]);
}

/** True when `latest` is a newer version than `current`; false for anything unreadable. */
export function isNewerVersion(latest: string, current: string): boolean {
  const order = compareVersions(latest, current);
  return order !== null && order > 0;
}

/** The line Studio prints on start when a newer release exists. */
export function updateMessage(current: string, latest: string): string {
  return (
    `A new version of portless-studio is available: ${current} -> ${latest}. ` +
    `Update with: ${UPDATE_COMMAND}`
  );
}

function comparePrereleases(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index];
    const y = right[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const difference = Number(x) - Number(y);
      if (difference !== 0) return Math.sign(difference);
    } else if (xNumeric !== yNumeric) {
      // Numeric identifiers sort before alphanumeric ones.
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
