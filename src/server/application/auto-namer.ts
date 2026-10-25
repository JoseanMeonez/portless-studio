import type { DetectedPort } from "../../core/ports/detected-port.ts";
import { parseRouteName } from "../../core/routes/route-name.ts";
import type { RouteRegistry } from "./route-registry.ts";

export type AutoNamerHooks = {
  /** Called after each name auto mode gives. */
  onNamed?: (name: string, port: number) => void | Promise<void>;
  /**
   * True when a taken name may move to the new port: auto mode gave it and its server is gone,
   * so the project came back on another port.
   */
  canTake?: (name: string) => boolean;
  /**
   * In how many scans in a row a port must show up unnamed before it gets a name; 2 by default.
   * `portless <name> <command>` registers its route a moment after the server listens, and the
   * wait keeps auto mode from naming that server first.
   */
  stableScans?: number;
};

/**
 * Auto mode: gives each detected port its suggested name. Every port and process pair gets one
 * attempt, so a name that keeps failing is not retried on every scan.
 */
export class AutoNamer {
  readonly #registry: RouteRegistry;
  readonly #log: (line: string) => void;
  readonly #hooks: AutoNamerHooks;
  readonly #attempted = new Set<string>();
  /** In how many scans in a row each port and process pair showed up unnamed. */
  #streaks = new Map<string, number>();

  constructor(registry: RouteRegistry, log: (line: string) => void, hooks: AutoNamerHooks = {}) {
    this.#registry = registry;
    this.#log = log;
    this.#hooks = hooks;
  }

  /** Returns how many ports got a name. */
  async name(detected: readonly DetectedPort[]): Promise<number> {
    const stableScans = this.#hooks.stableScans ?? 2;
    const streaks = new Map<string, number>();
    let named = 0;
    for (const port of detected) {
      if (port.suggestedName === null) continue;
      const key = `${port.port}:${port.pid}`;
      if (this.#attempted.has(key)) continue;
      const streak = (this.#streaks.get(key) ?? 0) + 1;
      streaks.set(key, streak);
      if (streak < stableScans) continue;
      this.#attempted.add(key);
      if (await this.#nameOne(port.port, port.suggestedName)) named += 1;
    }
    // A port missing from this scan starts counting again when it comes back.
    this.#streaks = streaks;
    return named;
  }

  async #nameOne(port: number, suggested: string): Promise<boolean> {
    // The scan is a few seconds old; portless may have registered the port since.
    const { routes } = await this.#registry.readSnapshot();
    if (routes.some((route) => route.port === port)) return false;
    let lastError = "";
    // The second name keeps two servers of the same project apart: `web.acme-4321`.
    for (const candidate of [suggested, `${suggested}-${port}`]) {
      const name = parseRouteName(candidate);
      if (!name.ok) {
        lastError = `"${candidate}" is not a valid name`;
        break;
      }
      let created = await this.#registry.createAlias(name.value, port, false);
      if (!created.ok && created.error.code === "name_taken" && this.#hooks.canTake?.(name.value)) {
        created = await this.#registry.createAlias(name.value, port, true);
      }
      if (created.ok) {
        this.#log(`named ${port} -> ${name.value}`);
        await this.#hooks.onNamed?.(name.value, port);
        return true;
      }
      lastError = created.error.message;
      if (created.error.code !== "name_taken") break;
    }
    this.#log(`could not name ${port}: ${lastError}`);
    return false;
  }
}
