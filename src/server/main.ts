import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { RouteRegistry } from "./application/route-registry.ts";
import { PortlessRegistry } from "./infrastructure/portless/portless-registry.ts";
import { resolveStateDir } from "./infrastructure/portless/state-files.ts";
import { createHttpServer } from "./interface/http/http-server.ts";

/** Only this machine can connect; see docs/architecture.md, Security. */
const LOOPBACK = "127.0.0.1";

export type ServerOptions = {
  /** 0 picks a free port. */
  port: number;
  /** Portless state directory; defaults to `PORTLESS_STATE_DIR` or `~/.portless`. */
  stateDir?: string | undefined;
  /** Built web app; omit to serve only the API. */
  webDir?: string | undefined;
  /** Portless binary used for writes; defaults to `PORTLESS_BIN` or `portless` on PATH. */
  portlessBin?: string | undefined;
};

export type RunningServer = {
  url: string;
  port: number;
  token: string;
  registry: RouteRegistry;
  close(): Promise<void>;
};

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const registry = new PortlessRegistry({
    stateDir: options.stateDir ?? resolveStateDir(),
    bin: options.portlessBin ?? (process.env.PORTLESS_BIN || "portless"),
  });
  const token = randomBytes(32).toString("base64url");
  const http = createHttpServer({ registry, token, webDir: options.webDir });

  await new Promise<void>((resolve, reject) => {
    http.server.once("error", reject);
    http.server.listen(options.port, LOOPBACK, () => {
      http.server.off("error", reject);
      resolve();
    });
  });
  const { port } = http.server.address() as AddressInfo;

  return {
    url: `http://${LOOPBACK}:${port}`,
    port,
    token,
    registry,
    close: () =>
      new Promise((resolve) => {
        http.closeStreams();
        http.server.close(() => resolve());
        http.server.closeAllConnections();
      }),
  };
}
