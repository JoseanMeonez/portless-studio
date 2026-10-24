import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ProxyAction } from "../core/api/contract.ts";
import type { DetectedPort } from "../core/ports/detected-port.ts";
import type { Result } from "../core/result.ts";
import type { AppError } from "./application/app-error.ts";
import type { AutoNamedStore } from "./application/auto-named-store.ts";
import type { ConfigStore } from "./application/config-store.ts";
import { createDoctorService, type DoctorService } from "./application/doctor.ts";
import type { PortScanner } from "./application/port-scanner.ts";
import type { ProcessOwner } from "./application/process-control.ts";
import { controlProxy } from "./application/proxy-control.ts";
import type { RouteRegistry } from "./application/route-registry.ts";
import { stopProcess } from "./application/stop-process.ts";
import { StudioRuntime } from "./application/studio-runtime.ts";
import type { StudioServiceControl } from "./application/studio-service.ts";
import {
  autoNamedPathFor,
  JsonAutoNamedStore,
} from "./infrastructure/config/json-auto-named-store.ts";
import { defaultConfigPath, JsonConfigStore } from "./infrastructure/config/json-config-store.ts";
import {
  type ProxyStartRecord,
  proxyStartRecordPathFor,
  readProxyStartRecord,
  recordProxyStarts,
} from "./infrastructure/config/proxy-start-record.ts";
import { PortlessRegistry } from "./infrastructure/portless/portless-registry.ts";
import { resolveStateDir } from "./infrastructure/portless/state-files.ts";
import { collectDoctorFacts, proxyPidsAmong } from "./infrastructure/system/doctor-facts.ts";
import { FaviconFetcher } from "./infrastructure/system/favicon-fetcher.ts";
import { OsNotifier } from "./infrastructure/system/os-notifier.ts";
import { ProjectInfoReader } from "./infrastructure/system/project-info.ts";
import { nodeSystemIo } from "./infrastructure/system/system-io.ts";
import {
  createPortScanner,
  listPortsFor,
  probeHttpResponse,
} from "./infrastructure/system/system-port-scanner.ts";
import { SystemProcessControl } from "./infrastructure/system/system-process-control.ts";
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
  /** Health checks and the fixes Studio can run itself. */
  doctor: DoctorService;
  controlProxy(action: ProxyAction): Promise<Result<string, AppError>>;
  stopProcess(pid: string): Promise<Result<{ pid: number; port: number }, AppError>>;
  /** Restart and stop for Studio itself, when the CLI provides them. */
  studioService?: StudioServiceControl | undefined;
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
  /** Restart and stop for Studio itself; the doctor also reads the login service from it. */
  studioService?: StudioServiceControl | undefined;
};

// Lets startServer reuse the runtime behind services built here, so both share one scan cache.
const runtimes = new WeakMap<StudioServices, StudioRuntime>();

export function createStudioServices(options: StudioServicesOptions = {}): StudioServices {
  const stateDir = options.stateDir ?? resolveStateDir();
  const configPath = options.configPath ?? defaultConfigPath();
  const portless = new PortlessRegistry({
    stateDir,
    bin: options.portlessBin ?? (process.env.PORTLESS_BIN || "portless"),
    ...(options.npmBin === undefined ? {} : { npmBin: options.npmBin }),
  });
  // Every proxy Studio starts is written down, so `uninstall` stops only Studio's own.
  const registry = recordProxyStarts(portless, proxyStartRecordPathFor(configPath));
  const scanner = createPortScanner();
  const configStore = new JsonConfigStore(configPath);
  const notifier = new OsNotifier({ platform: process.platform });
  const runtime = new StudioRuntime({
    registry,
    scanner,
    configStore,
    projects: new ProjectInfoReader(),
    studioPort: options.studioPort ?? null,
    probe: (port) => probeHttpResponse(port),
    proxyPids: (pids) => proxyPidsAmong(process.platform, nodeSystemIo, pids),
    autoNamedStore: new JsonAutoNamedStore(autoNamedPathFor(configPath)),
    notifier,
    icons: new FaviconFetcher(),
  });
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const processes = new SystemProcessControl({
    platform: process.platform,
    io: nodeSystemIo,
    uid,
    userName: os.userInfo().username,
  });
  const proxy = (action: ProxyAction) =>
    controlProxy(action, { registry, processes, config: () => runtime.settings() });
  const studioService = options.studioService;
  const doctor = createDoctorService({
    collect: () =>
      collectDoctorFacts({
        platform: process.platform,
        homeDir: os.homedir(),
        stateDir,
        uid,
        registry,
        configStore,
        processes,
        io: nodeSystemIo,
        listPorts: listPortsFor(process.platform, nodeSystemIo),
        probe: (port) => probeHttpResponse(port),
        ...(studioService ? { loginService: () => studioService.status() } : {}),
        systemNotifier: () => notifier.availability(),
      }),
    controlProxy: proxy,
    updateConfig: (config) => runtime.updateConfig(config),
  });
  const services: StudioServices = {
    registry,
    scanner,
    configStore,
    detectPorts: () => runtime.detectPorts(),
    doctor,
    controlProxy: proxy,
    stopProcess: (pid) =>
      stopProcess(pid, {
        processes,
        stoppablePids: () => runtime.stoppablePids(),
        selfPid: process.pid,
      }),
    studioService,
  };
  runtimes.set(services, runtime);
  return services;
}

/** What `uninstall` needs besides the registry: Studio's own files and who runs a process. */
export type UninstallServices = {
  configDir: string;
  configExists: boolean;
  /** File names in `configDir` that Studio writes. */
  studioFiles: string[];
  autoNamed: AutoNamedStore;
  proxyRecord: ProxyStartRecord | null;
  forgetProxyRecord: () => void;
  ownerOf: (pid: number) => Promise<ProcessOwner>;
};

export function createUninstallServices(configPath = defaultConfigPath()): UninstallServices {
  const autoNamedPath = autoNamedPathFor(configPath);
  const recordPath = proxyStartRecordPathFor(configPath);
  const processes = new SystemProcessControl({
    platform: process.platform,
    io: nodeSystemIo,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    userName: os.userInfo().username,
  });
  return {
    configDir: path.dirname(configPath),
    configExists: [configPath, autoNamedPath, recordPath].some((file) => fs.existsSync(file)),
    studioFiles: [configPath, autoNamedPath, recordPath].map((file) => path.basename(file)),
    autoNamed: new JsonAutoNamedStore(autoNamedPath),
    proxyRecord: readProxyStartRecord(recordPath),
    forgetProxyRecord: () => fs.rmSync(recordPath, { force: true }),
    ownerOf: (pid) => processes.ownerOf(pid),
  };
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
    doctor: services.doctor,
    controlProxy: services.controlProxy,
    stopProcess: services.stopProcess,
    ...(services.studioService ? { studioService: services.studioService } : {}),
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
