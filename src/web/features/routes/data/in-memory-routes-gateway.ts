import type {
  ApiError,
  CreateAliasRequest,
  RenameAliasRequest,
  Snapshot,
} from "../../../../core/api/contract.ts";
import { err, ok, type Result } from "../../../../core/result.ts";
import { type Route, routeUrl } from "../../../../core/routes/route.ts";
import { parsePort, parseRouteName } from "../../../../core/routes/route-name.ts";
import type { ConnectionListener, RoutesGateway, SnapshotListener } from "./routes-gateway.ts";

/**
 * `RoutesGateway` that keeps routes in memory. Tests use it to drive the UI, and `?demo` uses it
 * to show the app without a server. It follows the same rules as the real API.
 */
export class InMemoryRoutesGateway implements RoutesGateway {
  #snapshot: Snapshot;
  readonly #listeners = new Set<SnapshotListener>();
  readonly #now: () => number;

  constructor(initial: Snapshot, now: () => number = Date.now) {
    this.#snapshot = initial;
    this.#now = now;
  }

  async getSnapshot(): Promise<Result<Snapshot, ApiError>> {
    return ok(this.#snapshot);
  }

  subscribe(listener: SnapshotListener, onConnectionChange?: ConnectionListener): () => void {
    this.#listeners.add(listener);
    onConnectionChange?.("open");
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Replaces the whole state and notifies subscribers, as a server push would. */
  emit(snapshot: Snapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }

  async createAlias(request: CreateAliasRequest): Promise<Result<null, ApiError>> {
    const name = parseRouteName(request.name);
    if (!name.ok)
      return err({ error: "invalid_name", message: `"${request.name}" is not a valid name.` });
    const port = parsePort(request.port);
    if (!port.ok)
      return err({ error: "invalid_port", message: `${request.port} is not a valid port.` });

    const existing = this.#find(name.value);
    if (existing && !request.force) {
      return err({
        error: "name_taken",
        message: `${name.value} already points to port ${existing.port}.`,
      });
    }
    const routes = this.#snapshot.routes.filter((route) => route.name !== name.value);
    this.#update([...routes, this.#alias(name.value, port.value)]);
    return ok(null);
  }

  async renameAlias(
    currentName: string,
    request: RenameAliasRequest,
  ): Promise<Result<null, ApiError>> {
    const current = this.#find(currentName);
    if (!current) return err({ error: "not_found", message: `${currentName} does not exist.` });
    if (current.kind !== "alias")
      return err({ error: "not_an_alias", message: `${currentName} is an app, not an alias.` });
    const name = parseRouteName(request.name);
    if (!name.ok)
      return err({ error: "invalid_name", message: `"${request.name}" is not a valid name.` });
    if (name.value !== currentName && this.#find(name.value)) {
      return err({ error: "name_taken", message: `${name.value} is already taken.` });
    }
    this.#update(
      this.#snapshot.routes.map((route) =>
        route === current
          ? { ...this.#alias(name.value, route.port), registeredAt: route.registeredAt }
          : route,
      ),
    );
    return ok(null);
  }

  async removeAlias(name: string): Promise<Result<null, ApiError>> {
    const current = this.#find(name);
    if (!current) return err({ error: "not_found", message: `${name} does not exist.` });
    if (current.kind !== "alias")
      return err({ error: "not_an_alias", message: `${name} is an app, not an alias.` });
    this.#update(this.#snapshot.routes.filter((route) => route !== current));
    return ok(null);
  }

  #find(name: string): Route | undefined {
    return this.#snapshot.routes.find((route) => route.name === name);
  }

  #alias(name: string, port: number): Route {
    const hostname = `${name}.${this.#snapshot.proxy.tlds[0] ?? "localhost"}`;
    return {
      hostname,
      name,
      port,
      kind: "alias",
      pid: null,
      registeredAt: this.#now(),
      url: routeUrl(hostname, this.#snapshot.proxy),
      tunnels: [],
    };
  }

  #update(routes: Route[]): void {
    this.emit({ ...this.#snapshot, routes, readAt: this.#now() });
  }
}
