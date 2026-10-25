import { parseDockerPs } from "../../../core/ports/docker-container.ts";
import { err, ok, type Result } from "../../../core/result.ts";
import { type AppError, appError } from "../../application/app-error.ts";
import type { ContainerReading, ContainerSource } from "../../application/container-source.ts";
import { execute } from "../portless/portless-cli.ts";

/** One `docker` command: its exit code, output, and whether the command exists at all. */
export type DockerRun = (
  args: string[],
  timeoutMs: number,
) => Promise<{ exitCode: number | null; stdout: string; combined: string; missing: boolean }>;

export type DockerContainersOptions = {
  run?: DockerRun;
  now?: () => number;
};

/** A scan runs every few seconds; one `docker ps` serves the scans in between. */
const FRESH_MS = 3000;
/** Docker that is stopped or refuses this user is asked again less often. */
const UNAVAILABLE_MS = 15_000;
/** No `docker` on PATH: asked again in case it gets installed. */
const MISSING_MS = 60_000;
const LIST_TIMEOUT_MS = 2000;
/** `docker stop` waits up to 10 seconds for the container before it kills it. */
const STOP_TIMEOUT_MS = 30_000;
const LIST_ARGS = ["ps", "--format", "{{json .}}"];

const defaultRun: DockerRun = (args, timeoutMs) => execute("docker", args, { timeoutMs });

/**
 * Reads running containers with `docker ps`, which works the same with Docker Engine on Linux and
 * with Docker Desktop, OrbStack or Colima on macOS and Windows. Any failure reads as no containers.
 */
export class DockerContainers implements ContainerSource {
  readonly #run: DockerRun;
  readonly #now: () => number;
  #last: { reading: ContainerReading; at: number } | null = null;
  #reading: Promise<ContainerReading> | null = null;

  constructor(options: DockerContainersOptions = {}) {
    this.#run = options.run ?? defaultRun;
    this.#now = options.now ?? Date.now;
  }

  read(): Promise<ContainerReading> {
    const last = this.#last;
    if (last && this.#now() - last.at < maxAge(last.reading)) return Promise.resolve(last.reading);
    this.#reading ??= this.#list().then((reading) => {
      this.#last = { reading, at: this.#now() };
      this.#reading = null;
      return reading;
    });
    return this.#reading;
  }

  async stop(name: string): Promise<Result<void, AppError>> {
    const outcome = await this.#run(["stop", name], STOP_TIMEOUT_MS).catch(() => null);
    // The next read lists the containers again instead of showing the stopped one.
    this.#last = null;
    if (outcome?.exitCode === 0) return ok(undefined);
    const printed = outcome?.combined.trim() ?? "";
    return err(
      appError(
        "command_failed",
        printed || `docker stop ${name} did not finish.`,
        `docker stop ${name}`,
      ),
    );
  }

  async #list(): Promise<ContainerReading> {
    const outcome = await this.#run(LIST_ARGS, LIST_TIMEOUT_MS).catch(() => null);
    if (outcome === null) return { state: "unavailable" };
    if (outcome.missing) return { state: "missing" };
    if (outcome.exitCode !== 0) return { state: "unavailable" };
    return { state: "ok", containers: parseDockerPs(outcome.stdout) };
  }
}

function maxAge(reading: ContainerReading): number {
  if (reading.state === "ok") return FRESH_MS;
  return reading.state === "missing" ? MISSING_MS : UNAVAILABLE_MS;
}
