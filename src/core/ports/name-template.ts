import { err, ok, type Result } from "../result.ts";

/**
 * How suggested names are built. The work comes first and the repository last, the order portless
 * itself uses for worktrees (`<branch>.<name>.localhost`), so the most specific label leads.
 */
export const DEFAULT_NAME_TEMPLATE = "{work}.{package}.{repo}";

export const NAME_TOKENS = [
  "work",
  "branch",
  "ticket",
  "package",
  "repo",
  "worktree",
  "folder",
  "port",
] as const;

export type NameToken = (typeof NAME_TOKENS)[number];

/** One line per token, for the settings panel. */
export const NAME_TOKEN_HELP: Record<NameToken, string> = {
  work: "ticket key from the branch, else its last segment; on the default branch, the worktree",
  branch: "the whole branch",
  ticket: "ticket key from the branch only",
  package: "package.json name without its scope",
  repo: "repository folder",
  worktree: "linked worktree folder",
  folder: "folder the server runs in",
  port: "port number",
};

// Tokens that say which app a name belongs to; a name made only of the branch would collide.
const APP_TOKENS = new Set<NameToken>(["package", "repo", "folder", "port"]);

export type TemplatePart = { literal: string } | { token: NameToken };
/** A parsed template: one list of parts per dot-separated label. */
export type NameTemplate = TemplatePart[][];

const TOKEN_LIST = NAME_TOKENS.map((token) => `{${token}}`).join(", ");

/** Reads a template like `{ticket}.{repo}`; the error says what to fix, without a field name. */
export function parseNameTemplate(text: string): Result<NameTemplate, string> {
  if (text.trim() === "") return err(`must not be empty; the default is ${DEFAULT_NAME_TEMPLATE}.`);
  const labels: NameTemplate = [[]];
  let usesApp = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "{") {
      const end = text.indexOf("}", index);
      if (end === -1) return err(`has a "{" without its closing "}".`);
      const name = text.slice(index + 1, end);
      if (!(NAME_TOKENS as readonly string[]).includes(name)) {
        return err(`has an unknown token {${name}}; use ${TOKEN_LIST}.`);
      }
      const token = name as NameToken;
      if (APP_TOKENS.has(token)) usesApp = true;
      labels[labels.length - 1]?.push({ token });
      index = end + 1;
    } else if (char === ".") {
      labels.push([]);
      index += 1;
    } else if (/[A-Za-z0-9-]/.test(char)) {
      labels[labels.length - 1]?.push({ literal: char });
      index += 1;
    } else {
      return err(`may only hold tokens, letters, digits, dashes and dots, not "${char}".`);
    }
  }
  if (!usesApp) {
    return err("needs {package}, {repo}, {folder} or {port}, so two apps never share a name.");
  }
  return ok(labels);
}

/**
 * Renders a template with each token's value, `null` when unknown. Empty labels and the dots around
 * them are dropped, a label equal to the one before it is dropped (`shop-admin.shop-admin`), and
 * every label becomes a DNS label of at most 63 characters. Null when no label names the app.
 */
export function renderNameTemplate(
  template: NameTemplate,
  values: Record<NameToken, string | null>,
): string | null {
  const labels: string[] = [];
  let namesApp = false;
  for (const parts of template) {
    let text = "";
    let hasApp = false;
    for (const part of parts) {
      if ("literal" in part) {
        text += part.literal;
        continue;
      }
      const value = values[part.token];
      if (value === null || value === "") continue;
      text += value;
      if (APP_TOKENS.has(part.token)) hasApp = true;
    }
    const label = dnsLabel(text);
    if (label === null) continue;
    namesApp ||= hasApp;
    if (labels.at(-1) !== label) labels.push(label);
  }
  return namesApp && labels.length > 0 ? labels.join(".") : null;
}

/** Lowercase letters, digits and inner dashes, at most 63 characters; null when nothing is left. */
export function dnsLabel(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  return cleaned === "" ? null : cleaned;
}
