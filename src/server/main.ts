import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { DetectedPort } from "../core/ports/detected-port.ts";
import type { ConfigStore } from "./application/config-store.ts";
import type { PortScanner } from "./application/port-scanner.ts";
import type { RouteRegistry } from "./application/route-registry.ts";
import { StudioRuntime } from "./application/studio-runtime.ts";
import { defaultConfigPath, JsonConfigStore } from "./infrastructure/config/json-config-store.ts";
import { PortlessRegistry } from "./infrastructure/portless/portless-registry.ts";
import { resolveStateDir } from "./infrastructure/portless/state-files.ts";
import { ProjectInfoReader } from "./infrastructure/system/project-info.ts";
import { createPortScanner } from "./infrastructure/system/system-port-scanner.ts";
import { createHttpServer } from "./interface/http/http-server.ts";

export { defaultConfigPath } from "./infrastructure/config/json-config-store.ts";

/** Only this machine can connect; see docs/architecture.md, Security. */
const LOOPBACK = "127.0.0.1";

/** The adapters Studio runs on, shared by the server and the `init` command. */
export type StudioServices = {
  registry: RouteRegistry;
  scanner: PortScanner;
  configStore: ConfigStore;
  /** One scan with the current config, same filtering as the UI. */
  detectPorts(): Promise<DetectedPort[]>;
};

export type StudioServicesOptions = {
  /** Portless state directory; defaults to `PORTLESS_STATE_DIR` or `~/.portless`. */
  stateDir?: string | undefined;
  /** Portless binary used for writes; defaults to `PORTLESS_BIN` or `portless` on PATH. */
  portlessBin?: string | undefined;
  /** npm used to install portless; defaults to `npm` on PATH. */
  npmBin?: string | undefined;
  /** Config file; defaults to `defaultConfigPath()`. */
  configPath?: string | undefined;
  /** Studio's own port, left out of detected ports. */
  studioPort?: number | undefined;
};

// Lets startServer reuse the runtime behind services built here, so both share one scan cache.
const runtimes = new WeakMap<StudioServices, StudioRuntime>();

export function createStudioServices(options: StudioServicesOptions = {}): StudioServices {
  const registry = new PortlessRegistry({
    stateDir: options.stateDir ?? resolveStateDir(),
    bin: options.portlessBin ?? (process.env.PORTLESS_BIN || "portless"),
    ...(options.npmBin === undefined ? {} : { npmBin: options.npmBin }),
  });
  const scanner = createPortScanner();
  const configStore = new JsonConfigStore(options.configPath ?? defaultConfigPath());
  const runtime = new StudioRuntime({
    registry,
    scanner,
    configStore,
    projects: new ProjectInfoReader(),
    studioPort: options.studioPort ?? null,
  });
  const services: StudioServices = {
    registry,
    scanner,
    configStore,
    detectPorts: () => runtime.detectPorts(),
  };
  runtimes.set(services, runtime);
  return services;
}

export type ServerOptions = {
  /** 0 picks a free port. */
  port: number;
  /** Portless state directory; defaults to `PORTLESS_STATE_DIR` or `~/.portless`. */
  stateDir?: string | undefined;
  /** Built web app; omit to serve only the API. */
  webDir?: string | undefined;
  /** Portless binary used for writes; defaults to `PORTLESS_BIN` or `portless` on PATH. */
  portlessBin?: string | undefined;
  /** Config file; defaults to `defaultConfigPath()`. Ignored when `services` is given. */
  configPath?: string | undefined;
  /** Adapters to run on; built from the options above when omitted. */
  services?: StudioServices | undefined;
};

export type RunningServer = {
  url: string;
  port: number;
  token: string;
  registry: RouteRegistry;
  services: StudioServices;
  close(): Promise<void>;
};

export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const services =
    options.services ??
    createStudioServices({
      stateDir: options.stateDir,
      portlessBin: options.portlessBin,
      configPath: options.configPath,
    });
  const studio =
    runtimes.get(services) ??
    new StudioRuntime({
      registry: services.registry,
      scanner: services.scanner,
      configStore: services.configStore,
      projects: new ProjectInfoReader(),
    });
  const token = randomBytes(32).toString("base64url");
  const http = createHttpServer({
    registry: services.registry,
    studio,
    token,
    webDir: options.webDir,
  });

  await new Promise<void>((resolve, reject) => {
    http.server.once("error", reject);
    http.server.listen(options.port, LOOPBACK, () => {
      http.server.off("error", reject);
      resolve();
    });
  });
  const { port } = http.server.address() as AddressInfo;
  studio.setStudioPort(port);
  studio.start();

  return {
    url: `http://${LOOPBACK}:${port}`,
    port,
    token,
    registry: services.registry,
    services,
    close: () =>
      new Promise((resolve) => {
        studio.stop();
        http.closeStreams();
        http.server.close(() => resolve());
        http.server.closeAllConnections();
      }),
  };
}
