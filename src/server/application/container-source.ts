import type { DockerContainer } from "../../core/ports/docker-container.ts";
import { isContainerName } from "../../core/ports/docker-container.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { type AppError, appError } from "./app-error.ts";

/**
 * What `docker ps` gave: the containers, no `docker` command on this machine, or a command that
 * could not list them (Docker not running, no permission, too slow).
 */
export type ContainerReading =
  | { state: "ok"; containers: DockerContainer[] }
  | { state: "missing" }
  | { state: "unavailable" };

/** Lists running containers and stops one. The default implementation runs the `docker` CLI. */
export interface ContainerSource {
  read(): Promise<ContainerReading>;
  stop(name: string): Promise<Result<void, AppError>>;
}

/**
 * Stops a container from its row. Only a container the last `docker ps` listed can be stopped, so
 * the endpoint cannot be used to stop anything else.
 */
export async function stopContainer(
  name: string,
  source: ContainerSource,
): Promise<Result<{ name: string }, AppError>> {
  if (!isContainerName(name)) {
    return err(appError("invalid_request", "That is not a Docker container name."));
  }
  const reading = await source.read();
  const listed = reading.state === "ok" && reading.containers.some((item) => item.name === name);
  if (!listed) {
    return err(
      appError(
        "process_not_allowed",
        `Container ${name} is not one Studio shows; it may have stopped.`,
      ),
    );
  }
  const stopped = await source.stop(name);
  return stopped.ok ? ok({ name }) : stopped;
}
