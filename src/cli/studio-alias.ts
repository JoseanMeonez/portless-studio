import { connect } from "node:net";
import type { RouteRegistry } from "../server/application/route-registry.ts";
import { probeHttpResponse } from "../server/infrastructure/system/system-port-scanner.ts";

export const STUDIO_ALIAS = "studio";

export type StudioAlias = {
  /** URL of the alias when it points to this server, `null` when it does not. */
  url: string | null;
  /** True when this run created the alias, so it should remove it on exit. */
  owned: boolean;
  /** Why the alias was not set, for the startup message. */
  note?: string;
};

export type StudioAliasDeps = {
  /** True when a Portless Studio answers on the port; asks it over HTTP by default. */
  isStudioAt?: (port: number) => Promise<boolean>;
};

/**
 * Names the dashboard `studio` in portless. Best effort: any failure leaves the plain URL working.
 * An existing `studio` alias is kept only while another Studio answers on its port; one left by
 * a Studio that stopped (its port closed or taken by another program) is replaced.
 */
export async function registerStudioAlias(
  registry: RouteRegistry,
  port: number,
  deps: StudioAliasDeps = {},
): Promise<StudioAlias> {
  const isStudioAt = deps.isStudioAt ?? studioAnswersOn;
  const current = await findStudio(registry);
  if (current?.port === port) return { url: current.url, owned: false };
  if (current?.kind === "app") {
    return { url: null, owned: false, note: `"${STUDIO_ALIAS}" belongs to a running app.` };
  }
  if (current && (await isStudioAt(current.port))) {
    return {
      url: null,
      owned: false,
      note: `"${STUDIO_ALIAS}" already points to another Studio on port ${current.port}.`,
    };
  }

  const created = await registry.createAlias(STUDIO_ALIAS, port, current !== undefined);
  if (!created.ok) return { url: null, owned: false, note: created.error.message };
  const registered = await findStudio(registry);
  return { url: registered?.port === port ? registered.url : null, owned: true };
}

/** Removes the alias only while it still points to this server. */
export async function unregisterStudioAlias(registry: RouteRegistry, port: number): Promise<void> {
  const current = await findStudio(registry);
  if (current?.kind === "alias" && current.port === port) {
    await registry.removeAlias(STUDIO_ALIAS);
  }
}

async function findStudio(registry: RouteRegistry) {
  const { routes } = await registry.readSnapshot();
  return routes.find((route) => route.name === STUDIO_ALIAS);
}

async function studioAnswersOn(port: number): Promise<boolean> {
  return (await probeHttpResponse(port))?.studio === true;
}

/** True when something accepts TCP connections on the loopback port. */
export function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}
