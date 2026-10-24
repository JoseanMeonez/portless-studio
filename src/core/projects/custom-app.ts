import { err, ok, type Result } from "../result.ts";

/** An app the person added to the open-with menu: a name and a command with `{path}` in it. */
export type CustomApp = {
  name: string;
  /** e.g. `kitty --directory {path} nvim`; without `{path}` the folder goes last. */
  command: string;
};

/** The folder placeholder in a custom command. */
export const PATH_PLACEHOLDER = "{path}";

export const MAX_CUSTOM_APPS = 20;
const MAX_NAME_LENGTH = 40;
const MAX_COMMAND_LENGTH = 500;

export function isCustomApp(value: unknown): value is CustomApp {
  if (typeof value !== "object" || value === null) return false;
  const app = value as Partial<CustomApp>;
  return typeof app.name === "string" && typeof app.command === "string";
}

/**
 * Splits a command into a program and its arguments without a shell: spaces separate words,
 * `"..."` and `'...'` keep spaces inside one word, and nothing else is special (backslashes stay,
 * so Windows paths work). Fails on an empty command or an unclosed quote.
 */
export function splitCommand(command: string): Result<string[], string> {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (quote !== null) return err("A quote in the command is not closed.");
  if (inWord) words.push(word);
  if (words.length === 0) return err("The command is empty.");
  return ok(words);
}

/**
 * The program and arguments that open `folder` with this command. `{path}` becomes the folder
 * inside whichever word holds it, so a folder with spaces stays one argument; a command without
 * `{path}` gets the folder as its last argument.
 */
export function commandFor(
  command: string,
  folder: string,
): Result<{ file: string; args: string[] }, string> {
  const words = splitCommand(command);
  if (!words.ok) return words;
  const [file = "", ...rest] = words.value;
  if (file === "" || file.includes(PATH_PLACEHOLDER)) {
    return err("The command must start with a program, not with {path}.");
  }
  const hasPlaceholder = rest.some((word) => word.includes(PATH_PLACEHOLDER));
  const args = hasPlaceholder
    ? rest.map((word) => word.split(PATH_PLACEHOLDER).join(folder))
    : [...rest, folder];
  return ok({ file, args });
}

/** Checks a list of custom apps from a request or a file; the message names the bad entry. */
export function parseCustomApps(input: unknown): Result<CustomApp[], string> {
  if (!Array.isArray(input)) return err("Custom apps must be a list.");
  if (input.length > MAX_CUSTOM_APPS) return err(`Add at most ${MAX_CUSTOM_APPS} custom apps.`);
  const apps: CustomApp[] = [];
  const names = new Set<string>();
  for (const [index, value] of input.entries()) {
    const position = `App ${index + 1}`;
    if (!isCustomApp(value)) return err(`${position} needs a name and a command.`);
    const name = value.name.trim();
    const command = value.command.trim();
    if (name === "" || name.length > MAX_NAME_LENGTH) {
      return err(`${position} needs a name of 1 to ${MAX_NAME_LENGTH} characters.`);
    }
    if (names.has(name.toLowerCase())) return err(`Two apps are called ${name}.`);
    names.add(name.toLowerCase());
    if (command.length > MAX_COMMAND_LENGTH) return err(`The command of ${name} is too long.`);
    const parsed = commandFor(command, "");
    if (!parsed.ok) return err(`${name}: ${parsed.error}`);
    apps.push({ name, command });
  }
  return ok(apps);
}

/** The id the open-with menu uses for the custom app at `index`. */
export function customAppId(index: number): string {
  return `custom-${index + 1}`;
}
