import * as fs from "node:fs";
import * as path from "node:path";
import type { UpdateCache, UpdateCacheStore } from "../../application/update-check.ts";
import { writeFileAtomic } from "./atomic-write.ts";

const FILE_NAME = "update-check.json";

/** `update-check.json` in the config file's folder. */
export function updateCheckPathFor(configPath: string): string {
  return path.join(path.dirname(configPath), FILE_NAME);
}

/** The last update check as `{ "checkedAt": <epoch ms>, "latest": "<version>" | null }`. */
export class JsonUpdateCache implements UpdateCacheStore {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  read(): UpdateCache | null {
    try {
      const json: unknown = JSON.parse(fs.readFileSync(this.#file, "utf8"));
      if (typeof json !== "object" || json === null) return null;
      const checkedAt = Reflect.get(json, "checkedAt");
      const latest = Reflect.get(json, "latest");
      if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt)) return null;
      if (latest !== null && typeof latest !== "string") return null;
      return { checkedAt, latest };
    } catch {
      return null;
    }
  }

  write(cache: UpdateCache): void {
    writeFileAtomic(this.#file, `${JSON.stringify(cache, null, 2)}\n`);
  }
}
