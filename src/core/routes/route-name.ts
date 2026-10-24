import { err, ok, type Result } from "../result.ts";

export type RouteNameError = "empty" | "too_long" | "invalid_label";

const MAX_HOSTNAME_LENGTH = 253;
// A DNS label: letters, digits and inner hyphens, at most 63 characters.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalizes what a person types as a route name (`My App`, `api.acme`) into the form portless
 * registers (`my-app`, `api.acme`), or says why it cannot be one.
 */
export function parseRouteName(input: string): Result<string, RouteNameError> {
  const name = input.trim().toLowerCase().replace(/\s+/g, "-");
  if (name === "") return err("empty");
  if (name.length > MAX_HOSTNAME_LENGTH) return err("too_long");
  if (!name.split(".").every((label) => LABEL.test(label))) return err("invalid_label");
  return ok(name);
}

export function parsePort(input: string | number): Result<number, "invalid_port"> {
  const port = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return err("invalid_port");
  return ok(port);
}
