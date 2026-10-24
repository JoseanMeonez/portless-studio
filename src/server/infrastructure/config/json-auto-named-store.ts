import * as fs from "node:fs";
import * as path from "node:path";
import type { AutoNamedEntry, AutoNamedStore } from "../../application/auto-named-store.ts";
import { writeFileAtomic } from "./atomic-write.ts";

const FILE_NAME = "auto-named.json";

/** `auto-named.json` in the config file's folder. */
export function autoNamedPathFor(configPath: string): string {
  return path.join(path.dirname(configPath), FILE_NAME);
}

/**
 * The names auto mode gave, as `{ "autoNamed": [{ name, port, createdAt }] }`. Kept apart from
 * the config because Studio writes it on its own; a person never needs to edit it.
 */
export class JsonAutoNamedStore implements AutoNamedStore {
  readonly path: string;

  constructor(filePath: string) {
    this.path = filePath;
  }

  async read(): Promise<AutoNamedEntry[]> {
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(this.path, "utf8"));
    } catch {
      return [];
    }
    const list = (json as { autoNamed?: unknown } | null)?.autoNamed;
    return Array.isArray(list) ? list.filter(isEntry) : [];
  }

  async write(entries: AutoNamedEntry[]): Promise<void> {
    writeFileAtomic(this.path, `${JSON.stringify({ autoNamed: entries }, null, 2)}\n`);
  }
}

function isEntry(value: unknown): value is AutoNamedEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<AutoNamedEntry>;
  return (
    typeof entry.name === "string" &&
    typeof entry.port === "number" &&
    typeof entry.createdAt === "number"
  );
}
