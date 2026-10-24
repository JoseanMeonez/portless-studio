import { timingSafeEqual } from "node:crypto";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Accepts loopback and `*.localhost` names with any port. Anything else is a DNS rebinding
 * attempt: a foreign name that resolves to 127.0.0.1 so a website can talk to this server.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = hostnameOf(host);
  if (hostname === null) return false;
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

/** A browser `Origin`, when sent, must name this same server; `null` origins never do. */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return true;
  if (!host) return false;
  try {
    return new URL(origin).host === new URL(`http://${host}`).host;
  } catch {
    return false;
  }
}

export function hasToken(header: string | string[] | undefined, token: string): boolean {
  if (typeof header !== "string") return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// `name[:port]` or `[ipv6][:port]` only; `new URL` would also accept userinfo and numeric IPs.
const HOST_HEADER = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i;

function hostnameOf(host: string): string | null {
  const match = HOST_HEADER.exec(host);
  return match?.[1]?.toLowerCase() ?? null;
}
