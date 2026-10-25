import { err, ok } from "../../core/result.ts";
import { appError } from "./app-error.ts";
import { type ContainerReading, type ContainerSource, stopContainer } from "./container-source.ts";

function fakeSource(reading: ContainerReading) {
  const stopped: string[] = [];
  const source: ContainerSource = {
    read: async () => reading,
    stop: async (name) => {
      stopped.push(name);
      return name === "stuck" ? err(appError("command_failed", "daemon error")) : ok(undefined);
    },
  };
  return { source, stopped };
}

const listed = (...names: string[]): ContainerReading => ({
  state: "ok",
  containers: names.map((name) => ({
    name,
    image: "img",
    composeProject: null,
    composeService: null,
    ports: [8080],
  })),
});

describe("stopContainer", () => {
  it("stops a container the last docker ps listed", async () => {
    const { source, stopped } = fakeSource(listed("acme-api-1"));
    expect(await stopContainer("acme-api-1", source)).toEqual(ok({ name: "acme-api-1" }));
    expect(stopped).toEqual(["acme-api-1"]);
  });

  it("refuses any other name, and names that are not container names", async () => {
    const { source, stopped } = fakeSource(listed("acme-api-1"));
    const other = await stopContainer("postgres", source);
    expect(other.ok ? null : other.error.code).toBe("process_not_allowed");
    const flag = await stopContainer("--all", source);
    expect(flag.ok ? null : flag.error.code).toBe("invalid_request");
    expect(stopped).toEqual([]);
  });

  it("refuses everything while Docker cannot be read", async () => {
    const { source, stopped } = fakeSource({ state: "unavailable" });
    const result = await stopContainer("acme-api-1", source);
    expect(result.ok ? null : result.error.code).toBe("process_not_allowed");
    expect(stopped).toEqual([]);
  });

  it("passes on what docker printed when the stop fails", async () => {
    const { source } = fakeSource(listed("stuck"));
    expect(await stopContainer("stuck", source)).toEqual(
      err(appError("command_failed", "daemon error")),
    );
  });
});
