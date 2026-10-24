import { DEFAULT_CONFIG } from "../../core/config/studio-config.ts";
import type { ProjectInfo } from "../../core/ports/detected-port.ts";
import type { Route } from "../../core/routes/route.ts";
import { discoverPorts, type ProjectInfoSource } from "./port-discovery.ts";
import type { ListeningPort, PortScanner } from "./port-scanner.ts";

function fakeScanner(ports: ListeningPort[], http: number[] = ports.map((p) => p.port)) {
  const probed: number[] = [];
  const scanner: PortScanner & { ports: ListeningPort[]; http: number[] } = {
    ports,
    http,
    scan: async () => scanner.ports,
    answersHttp: async (port) => {
      probed.push(port);
      return scanner.http.includes(port);
    },
  };
  return { scanner, probed };
}

const projects: ProjectInfoSource = {
  read: (cwd): ProjectInfo => ({
    packageName: cwd.endsWith("/web") ? "@acme/web" : null,
    repoName: cwd.includes("acme") ? "acme" : null,
    folderName: cwd.split("/").pop() ?? null,
    worktreeName: null,
  }),
};

const listening = (port: number, processName = "node", cwd: string | null = null) => ({
  port,
  pid: port * 10,
  processName,
  cwd,
});

const route = (port: number): Route => ({
  hostname: `r${port}.localhost`,
  name: `r${port}`,
  port,
  kind: "alias",
  pid: null,
  registeredAt: null,
  url: "",
  tunnels: [],
});

const withExe = (port: number, executable: string, cwd: string) => ({
  ...listening(port, executable.split("/").pop() ?? "", cwd),
  executable,
});

const rootedProjects: ProjectInfoSource = {
  read: (cwd): ProjectInfo => ({ ...projects.read(cwd), rootDir: "/code/acme" }),
};

describe("discoverPorts", () => {
  it("drops desktop apps and tools, keeps runtimes and binaries built in the project", async () => {
    const { scanner } = fakeScanner([
      withExe(5173, "/usr/bin/node", "/code/acme/apps/web"),
      withExe(7438, "/home/me/.local/bin/engram", "/code/acme"),
      withExe(6768, "/opt/orca/orca-ide", "/code/acme"),
      withExe(8080, "/code/acme/target/debug/api", "/code/acme"),
      withExe(8000, "/usr/bin/python3.12", "/code/acme"),
    ]);
    const detected = await discoverPorts(scanner, rootedProjects, {
      config: { ...DEFAULT_CONFIG, ignoredProcesses: [] },
      routes: [],
      excludedPorts: [],
    });
    expect(detected.map((port) => port.port)).toEqual([5173, 8000, 8080]);
  });

  it("keeps HTTP ports and suggests a name from the project folder", async () => {
    const { scanner } = fakeScanner([
      listening(5173, "node", "/code/acme/apps/web"),
      listening(4209, "ng", "/code/demo"),
      listening(9000, "python3", null),
    ]);
    const detected = await discoverPorts(scanner, projects, {
      config: DEFAULT_CONFIG,
      routes: [],
      excludedPorts: [],
    });
    expect(detected).toEqual([
      { port: 4209, pid: 42090, processName: "ng", cwd: "/code/demo", suggestedName: "demo" },
      {
        port: 5173,
        pid: 51730,
        processName: "node",
        cwd: "/code/acme/apps/web",
        suggestedName: "web.acme",
        project: { name: "acme", worktree: null },
      },
      { port: 9000, pid: 90000, processName: "python3", cwd: null, suggestedName: null },
    ]);
  });

  it("suggests names with the configured template", async () => {
    const { scanner } = fakeScanner([listening(5173, "node", "/code/acme/apps/web")]);
    const detected = await discoverPorts(scanner, projects, {
      config: { ...DEFAULT_CONFIG, nameTemplate: "{package}-{port}" },
      routes: [],
      excludedPorts: [],
    });
    expect(detected[0]?.suggestedName).toBe("web-5173");
  });

  it("drops routed, own, ignored, non-HTTP and other users' ports and ignored processes", async () => {
    const { scanner, probed } = fakeScanner(
      [
        listening(3000),
        listening(4949),
        listening(1355),
        listening(6000),
        listening(7000, "Code"),
        listening(5432, "postgres"),
        listening(8080),
        { port: 631, pid: null, processName: "", cwd: null },
      ],
      [3000, 4949, 1355, 6000, 7000, 8080, 631],
    );
    const detected = await discoverPorts(scanner, projects, {
      config: { ...DEFAULT_CONFIG, ignoredPorts: [6000] },
      routes: [route(3000)],
      excludedPorts: [4949, 1355],
    });
    expect(detected.map((d) => d.port)).toEqual([8080]);
    // Filtered ports are never probed: a probe can cost the full timeout.
    expect(probed.sort()).toEqual([5432, 8080]);
  });

  it("compares Windows paths without regard to case and never matches a sibling folder", async () => {
    const windowsProjects: ProjectInfoSource = {
      read: (cwd): ProjectInfo => ({ ...projects.read(cwd), rootDir: "C:\\code\\acme" }),
    };
    const { scanner } = fakeScanner([
      {
        ...listening(8080, "api", "C:\\code\\acme"),
        executable: "c:\\Code\\acme\\target\\api.exe",
      },
      {
        ...listening(8081, "tool", "C:\\code\\acme"),
        executable: "C:\\code\\acme-tools\\tool.exe",
      },
      { ...listening(5173, "node.exe", "C:\\code\\acme"), executable: "C:\\nodejs\\node.exe" },
    ]);
    const detected = await discoverPorts(scanner, windowsProjects, {
      config: { ...DEFAULT_CONFIG, ignoredProcesses: [] },
      routes: [],
      excludedPorts: [],
    });
    expect(detected.map((port) => port.port)).toEqual([5173, 8080]);
  });

  it("ignores helpers of an ignored app by the start of their name", async () => {
    const { scanner } = fakeScanner([
      listening(7001, "Code Helper (Plugin)"),
      listening(7002, "Google Chrome Helper"),
      listening(7003, "ControlCenter"),
      listening(7004, "rapportd"),
      listening(7005, "Electron"),
      listening(7006, "codex"),
    ]);
    const detected = await discoverPorts(scanner, projects, {
      config: DEFAULT_CONFIG,
      routes: [],
      excludedPorts: [],
    });
    expect(detected.map((port) => port.port)).toEqual([7006]);
  });
});
