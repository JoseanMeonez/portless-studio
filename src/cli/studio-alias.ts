import { connect } from "node:net";
import type { RouteRegistry } from "../server/application/route-registry.ts";

export const STUDIO_ALIAS = "studio";

export type StudioAlias = {
  /** URL of the alias when it points to this server, `null` when it does not. */
  url: string | null;
  /** True when this run created the alias, so it should remove it on exit. */
  owned: boolean;
  /** Why the alias was not set, for the startup message. */
  note?: string;
};

/**
 * Names the dashboard `studio` in portless. Best effort: any failure leaves the plain URL working.
 * An existing `studio` alias is replaced only when nothing listens on its port anymore.
 */
export async function registerStudioAlias(
  registry: RouteRegistry,
  port: number,
): Promise<StudioAlias> {
  const current = await findStudio(registry);
  if (current?.port === port) return { url: current.url, owned: false };
  if (current?.kind === "app") {
    return { url: null, owned: false, note: `"${STUDIO_ALIAS}" belongs to a running app.` };
  }
  if (current && (await isListening(current.port))) {
    return {
      url: null,
      owned: false,
      note: `"${STUDIO_ALIAS}" already points to port ${current.port}.`,
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

function isListening(port: number): Promise<boolean> {
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
