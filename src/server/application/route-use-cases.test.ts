import type { InstallPortlessResponse } from "../../core/api/contract.ts";
import { err, ok, type Result } from "../../core/result.ts";
import type { Route } from "../../core/routes/route.ts";
import type { AppError } from "./app-error.ts";
import type { PortlessState, RouteRegistry } from "./route-registry.ts";
import { createAlias, installPortless, removeAlias, renameAlias } from "./route-use-cases.ts";

function route(name: string, port: number, kind: Route["kind"]): Route {
  return {
    hostname: `${name}.localhost`,
    name,
    port,
    kind,
    pid: kind === "alias" ? null : 4242,
    registeredAt: null,
    url: `http://${name}.localhost:1355`,
    tunnels: [],
  };
}

class FakeRegistry implements RouteRegistry {
  routes: Route[];
  calls: string[] = [];
  removeResult: Result<void, AppError> = ok(undefined);
  createResult: Result<void, AppError> = ok(undefined);
  installResult: Result<InstallPortlessResponse, AppError> = ok({ version: "1.0.0", output: "" });

  constructor(routes: Route[]) {
    this.routes = routes;
  }

  async readSnapshot(): Promise<PortlessState> {
    return {
      proxy: { running: true, port: 1355, https: false, tlds: ["localhost"] },
      portless: { installed: true, version: "1.0.0" },
      routes: this.routes,
      readAt: 1,
    };
  }

  watch(): () => void {
    return () => {};
  }

  async createAlias(name: string, port: number, force: boolean) {
    this.calls.push(`create ${name} ${port} ${force}`);
    return this.createResult;
  }

  async removeAlias(name: string) {
    this.calls.push(`remove ${name}`);
    return this.removeResult;
  }

  async installPortless() {
    this.calls.push("install");
    return this.installResult;
  }
}

describe("createAlias", () => {
  it("normalizes the name and passes force through", async () => {
    const registry = new FakeRegistry([]);
    const result = await createAlias(registry, { name: " My DB ", port: 5432, force: true });
    expect(result.ok).toBe(true);
    expect(registry.calls).toEqual(["create my-db 5432 true"]);
  });

  it("rejects an invalid name without calling the registry", async () => {
    const registry = new FakeRegistry([]);
    const result = await createAlias(registry, { name: "bad_name!", port: 5432 });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_name" } });
    expect(registry.calls).toEqual([]);
  });

  it("rejects an invalid port", async () => {
    const registry = new FakeRegistry([]);
    const result = await createAlias(registry, { name: "db", port: 70000 });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_port" } });
  });

  it("returns the registry error", async () => {
    const registry = new FakeRegistry([]);
    registry.createResult = err({ code: "name_taken", message: "taken" });
    const result = await createAlias(registry, { name: "db", port: 5432 });
    expect(result).toMatchObject({ ok: false, error: { code: "name_taken" } });
  });
});

describe("removeAlias", () => {
  it("removes an alias", async () => {
    const registry = new FakeRegistry([route("db", 5432, "alias")]);
    expect((await removeAlias(registry, "db")).ok).toBe(true);
    expect(registry.calls).toEqual(["remove db"]);
  });

  it("rejects an unknown name with not_found", async () => {
    const registry = new FakeRegistry([]);
    const result = await removeAlias(registry, "db");
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(registry.calls).toEqual([]);
  });

  it("never passes a stored name that is not a valid route name to the CLI", async () => {
    const registry = new FakeRegistry([route("a&calc", 5432, "alias")]);
    const result = await removeAlias(registry, "a&calc");
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_name" } });
    expect(registry.calls).toEqual([]);
  });

  it("rejects an app route with not_an_alias", async () => {
    const registry = new FakeRegistry([route("web", 3000, "app")]);
    const result = await removeAlias(registry, "web");
    expect(result).toMatchObject({ ok: false, error: { code: "not_an_alias" } });
    expect(registry.calls).toEqual([]);
  });
});

describe("renameAlias", () => {
  it("creates the new name on the same port, then removes the old one", async () => {
    const registry = new FakeRegistry([route("db", 5432, "alias")]);
    const result = await renameAlias(registry, "db", { name: "Postgres" });
    expect(result.ok).toBe(true);
    expect(registry.calls).toEqual(["create postgres 5432 false", "remove db"]);
  });

  it("does nothing when the name does not change", async () => {
    const registry = new FakeRegistry([route("db", 5432, "alias")]);
    expect((await renameAlias(registry, "db", { name: "db" })).ok).toBe(true);
    expect(registry.calls).toEqual([]);
  });

  it("rejects an app route with not_an_alias", async () => {
    const registry = new FakeRegistry([route("web", 3000, "app")]);
    const result = await renameAlias(registry, "web", { name: "site" });
    expect(result).toMatchObject({ ok: false, error: { code: "not_an_alias" } });
  });

  it("rejects an unknown name with not_found", async () => {
    const registry = new FakeRegistry([]);
    const result = await renameAlias(registry, "db", { name: "site" });
    expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it("rejects an invalid new name", async () => {
    const registry = new FakeRegistry([route("db", 5432, "alias")]);
    const result = await renameAlias(registry, "db", { name: "" });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_name" } });
  });

  it("keeps the old alias when the new name is taken", async () => {
    const registry = new FakeRegistry([route("db", 5432, "alias")]);
    registry.createResult = err({ code: "name_taken", message: "taken" });
    const result = await renameAlias(registry, "db", { name: "web" });
    expect(result).toMatchObject({ ok: false, error: { code: "name_taken" } });
    expect(registry.calls).toEqual(["create web 5432 false"]);
  });

  it("reports when the old alias could not be removed", async () => {
    const registry = new FakeRegistry([route("db", 5432, "alias")]);
    registry.removeResult = err({ code: "internal", message: "lock" });
    const result = await renameAlias(registry, "db", { name: "pg" });
    expect(result).toMatchObject({ ok: false, error: { code: "internal" } });
    if (!result.ok) expect(result.error.message).toContain('"db"');
  });
});

describe("installPortless", () => {
  it("passes the registry result through", async () => {
    const registry = new FakeRegistry([]);
    registry.installResult = err({ code: "install_failed", message: "npm exited with code 1." });
    expect(await installPortless(registry)).toEqual(registry.installResult);
    expect(registry.calls).toEqual(["install"]);
  });
});
