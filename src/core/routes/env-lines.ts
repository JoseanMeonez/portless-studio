import { directUrl } from "../ports/direct-url.ts";
import { err, ok, type Result } from "../result.ts";

/** What a `.env` line needs from a route: its name, public URL and local port. */
export type EnvRoute = { name: string; url: string; port: number };

export type EnvOptions = {
  /** Put in front of every key, e.g. `VITE_` or `NEXT_PUBLIC_`; a missing trailing `_` is added. */
  prefix?: string;
  /** Suffix dropped from each name before it becomes a key: `acme` turns `api.acme` into `API_URL`. */
  strip?: string;
  /** Use `http://localhost:<port>` instead of the named URL. */
  direct?: boolean;
};

export type EnvEntry = { name: string; key: string; value: string };

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `api.acme` -> `API_ACME_URL`, with the strip suffix removed and the prefix in front. */
export function envKey(name: string, options: Pick<EnvOptions, "prefix" | "strip"> = {}): string {
  const suffix = stripSuffix(options.strip);
  const base = suffix !== null && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  const words = base
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const key = `${words === "" ? "" : `${words}_`}URL`;
  const prefix = options.prefix ?? "";
  if (prefix === "") return /^[0-9]/.test(key) ? `_${key}` : key;
  return `${prefix.endsWith("_") ? prefix : `${prefix}_`}${key}`;
}

/**
 * Keeps the routes the names point at: a name matches itself and every route ending in `.<name>`,
 * so `acme` picks `api.acme` and `web.acme`. No names keeps every route.
 */
export function selectEnvRoutes<T extends EnvRoute>(
  routes: readonly T[],
  names: readonly string[],
): Result<T[], string> {
  if (names.length === 0) return ok([...routes]);
  const matches = (route: T, name: string) =>
    route.name === name || route.name.endsWith(`.${name}`);
  const missing = names.find((name) => !routes.some((route) => matches(route, name)));
  if (missing !== undefined) return err(`No route matches "${missing}".`);
  return ok(routes.filter((route) => names.some((name) => matches(route, name))));
}

/** One key and value per route, sorted by route name; fails on a bad prefix or a repeated key. */
export function envEntries(
  routes: readonly EnvRoute[],
  options: EnvOptions = {},
): Result<EnvEntry[], string> {
  const prefix = options.prefix ?? "";
  if (prefix !== "" && !VARIABLE_NAME.test(prefix)) {
    return err(
      `The prefix "${prefix}" must use letters, digits and _, and not start with a digit.`,
    );
  }
  const sorted = [...routes].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const entries: EnvEntry[] = [];
  for (const route of sorted) {
    const key = envKey(route.name, options);
    const taken = entries.find((entry) => entry.key === key);
    if (taken) {
      return err(
        `${taken.name} and ${route.name} both become ${key}. Pass only one of them, or change the strip suffix.`,
      );
    }
    entries.push({
      name: route.name,
      key,
      value: options.direct ? directUrl(route.port) : route.url,
    });
  }
  return ok(entries);
}

/** `KEY=value` lines for a `.env` file, one per route. */
export function envLines(
  routes: readonly EnvRoute[],
  options: EnvOptions = {},
): Result<string[], string> {
  const entries = envEntries(routes, options);
  if (!entries.ok) return entries;
  return ok(entries.value.map(formatEnvLine));
}

export function formatEnvLine(entry: Pick<EnvEntry, "key" | "value">): string {
  return `${entry.key}=${quoteEnvValue(entry.value)}`;
}

/** Double quotes only when a `.env` reader would otherwise cut or change the value. */
function quoteEnvValue(value: string): string {
  if (value !== "" && !/[\s#"'`$\\]/.test(value)) return value;
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

function stripSuffix(strip: string | undefined): string | null {
  const trimmed = strip?.trim().replace(/^\.+/, "") ?? "";
  return trimmed === "" ? null : `.${trimmed}`;
}
