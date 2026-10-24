import type {
  CreateAliasRequest,
  InstallPortlessResponse,
  RenameAliasRequest,
} from "../../core/api/contract.ts";
import { err, ok, type Result } from "../../core/result.ts";
import type { Route } from "../../core/routes/route.ts";
import { parsePort, parseRouteName } from "../../core/routes/route-name.ts";
import { type AppError, appError } from "./app-error.ts";
import type { RouteRegistry } from "./route-registry.ts";

export async function createAlias(
  registry: RouteRegistry,
  request: CreateAliasRequest,
): Promise<Result<void, AppError>> {
  const name = validName(request.name);
  if (!name.ok) return name;
  const port = parsePort(request.port);
  if (!port.ok) return err(appError("invalid_port", "The port must be a number from 1 to 65535."));
  return registry.createAlias(name.value, port.value, request.force === true);
}

/** Renames an alias by creating the new name first, so a failure never leaves the port unnamed. */
export async function renameAlias(
  registry: RouteRegistry,
  currentName: string,
  request: RenameAliasRequest,
): Promise<Result<void, AppError>> {
  const current = await findAlias(registry, currentName);
  if (!current.ok) return current;
  const name = validName(request.name);
  if (!name.ok) return name;
  if (name.value === current.value.name) return ok(undefined);

  const created = await registry.createAlias(name.value, current.value.port, false);
  if (!created.ok) return created;

  const removed = await registry.removeAlias(current.value.name);
  if (!removed.ok) {
    return err(
      appError(
        removed.error.code,
        `Created "${name.value}" but could not remove "${current.value.name}": ${removed.error.message}`,
      ),
    );
  }
  return ok(undefined);
}

export async function removeAlias(
  registry: RouteRegistry,
  name: string,
): Promise<Result<void, AppError>> {
  const alias = await findAlias(registry, name);
  if (!alias.ok) return alias;
  return registry.removeAlias(alias.value.name);
}

/** The package and its arguments are fixed in the adapter; nothing from the request reaches npm. */
export function installPortless(
  registry: RouteRegistry,
): Promise<Result<InstallPortlessResponse, AppError>> {
  return registry.installPortless();
}

function validName(input: string): Result<string, AppError> {
  const name = parseRouteName(input);
  if (name.ok) return name;
  const reason = {
    empty: "The name cannot be empty.",
    too_long: "The name is longer than 253 characters.",
    invalid_label: "Use letters, digits, hyphens and dots, like my-app or api.my-app.",
  }[name.error];
  return err(appError("invalid_name", reason));
}

async function findAlias(registry: RouteRegistry, name: string): Promise<Result<Route, AppError>> {
  const { routes } = await registry.readSnapshot();
  const route = routes.find((candidate) => candidate.name === name || candidate.hostname === name);
  if (!route) return err(appError("not_found", `No route is named "${name}".`));
  if (route.kind !== "alias") {
    return err(
      appError("not_an_alias", `"${name}" belongs to a running app; only aliases can change.`),
    );
  }
  // The stored name goes to the portless CLI, which runs through cmd.exe on Windows.
  if (!parseRouteName(route.name).ok) {
    return err(
      appError(
        "invalid_name",
        `"${route.name}" is not a valid name; remove it with the portless CLI.`,
      ),
    );
  }
  return ok(route);
}
