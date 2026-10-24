import type { DetectedPort } from "../../core/ports/detected-port.ts";
import { parseRouteName } from "../../core/routes/route-name.ts";
import type { RouteRegistry } from "./route-registry.ts";

/**
 * Auto mode: gives each detected port its suggested name. Every port and process pair gets one
 * attempt, so a name that keeps failing is not retried on every scan.
 */
export class AutoNamer {
  readonly #registry: RouteRegistry;
  readonly #log: (line: string) => void;
  readonly #attempted = new Set<string>();

  constructor(registry: RouteRegistry, log: (line: string) => void) {
    this.#registry = registry;
    this.#log = log;
  }

  /** Returns how many ports got a name. */
  async name(detected: readonly DetectedPort[]): Promise<number> {
    let named = 0;
    for (const port of detected) {
      if (port.suggestedName === null) continue;
      const key = `${port.port}:${port.pid}`;
      if (this.#attempted.has(key)) continue;
      this.#attempted.add(key);
      if (await this.#nameOne(port.port, port.suggestedName)) named += 1;
    }
    return named;
  }

  async #nameOne(port: number, suggested: string): Promise<boolean> {
    let lastError = "";
    // The second name keeps two servers of the same project apart: `web.acme-4321`.
    for (const candidate of [suggested, `${suggested}-${port}`]) {
      const name = parseRouteName(candidate);
      if (!name.ok) {
        lastError = `"${candidate}" is not a valid name`;
        break;
      }
      const created = await this.#registry.createAlias(name.value, port, false);
      if (created.ok) {
        this.#log(`named ${port} -> ${name.value}`);
        return true;
      }
      lastError = created.error.message;
      if (created.error.code !== "name_taken") break;
    }
    this.#log(`could not name ${port}: ${lastError}`);
    return false;
  }
}
