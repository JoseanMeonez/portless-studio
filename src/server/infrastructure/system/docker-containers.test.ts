import { DockerContainers, type DockerRun } from "./docker-containers.ts";

type Answer = Awaited<ReturnType<DockerRun>>;

function fakeDocker(answers: Answer[]) {
  const calls: { args: string[]; timeoutMs: number }[] = [];
  let index = 0;
  const run: DockerRun = async (args, timeoutMs) => {
    calls.push({ args, timeoutMs });
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    if (!answer) throw new Error("no answer");
    return answer;
  };
  return { run, calls };
}

const answer = (exitCode: number | null, stdout = "", missing = false): Answer => ({
  exitCode,
  stdout,
  combined: stdout,
  missing,
});

const PS_LINE = JSON.stringify({
  Names: "acme-api-1",
  Image: "acme/api",
  Labels: "com.docker.compose.project=acme,com.docker.compose.service=api",
  Ports: "0.0.0.0:3000->3000/tcp",
});

describe("DockerContainers", () => {
  it("lists containers with one docker ps, a 2 second timeout and a short cache", async () => {
    let now = 0;
    const { run, calls } = fakeDocker([answer(0, `${PS_LINE}\n`)]);
    const docker = new DockerContainers({ run, now: () => now });
    const [first, second] = await Promise.all([docker.read(), docker.read()]);
    expect(first).toEqual({
      state: "ok",
      containers: [
        {
          name: "acme-api-1",
          image: "acme/api",
          composeProject: "acme",
          composeService: "api",
          ports: [3000],
        },
      ],
    });
    expect(second).toBe(first);
    expect(calls).toEqual([{ args: ["ps", "--format", "{{json .}}"], timeoutMs: 2000 }]);
    now = 2000;
    await docker.read();
    expect(calls).toHaveLength(1);
    now = 4000;
    await docker.read();
    expect(calls).toHaveLength(2);
  });

  it("reads as missing without docker, and unavailable when Docker is stopped, refuses or hangs", async () => {
    expect(
      await new DockerContainers({ run: fakeDocker([answer(null, "", true)]).run }).read(),
    ).toEqual({
      state: "missing",
    });
    expect(await new DockerContainers({ run: fakeDocker([answer(1)]).run }).read()).toEqual({
      state: "unavailable",
    });
    expect(await new DockerContainers({ run: fakeDocker([answer(null)]).run }).read()).toEqual({
      state: "unavailable",
    });
  });

  it("asks a stopped Docker again only after 15 seconds", async () => {
    let now = 0;
    const { run, calls } = fakeDocker([answer(1), answer(0, PS_LINE)]);
    const docker = new DockerContainers({ run, now: () => now });
    await docker.read();
    now = 10_000;
    expect((await docker.read()).state).toBe("unavailable");
    now = 15_000;
    expect((await docker.read()).state).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("stops a container by name and lists again on the next read", async () => {
    const { run, calls } = fakeDocker([answer(0, PS_LINE), answer(0, "acme-api-1"), answer(0, "")]);
    const docker = new DockerContainers({ run, now: () => 0 });
    await docker.read();
    expect(await docker.stop("acme-api-1")).toEqual({ ok: true, value: undefined });
    expect(calls[1]).toEqual({ args: ["stop", "acme-api-1"], timeoutMs: 30_000 });
    expect(await docker.read()).toEqual({ state: "ok", containers: [] });
  });

  it("reports what docker printed when a stop fails", async () => {
    const failed: Answer = {
      exitCode: 1,
      stdout: "",
      combined: "permission denied\n",
      missing: false,
    };
    const docker = new DockerContainers({ run: fakeDocker([failed]).run });
    const result = await docker.stop("web");
    expect(result).toEqual({
      ok: false,
      error: { code: "command_failed", message: "permission denied", command: "docker stop web" },
    });
  });
});
