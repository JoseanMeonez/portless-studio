import { suggestName } from "./detected-port.ts";
import {
  containerProjectInfo,
  isContainerName,
  parseDockerPs,
  parsePublishedPorts,
} from "./docker-container.ts";

const line = (fields: Record<string, string>) => JSON.stringify(fields);

describe("parsePublishedPorts", () => {
  it("reads IPv4 and IPv6 bindings once each", () => {
    expect(parsePublishedPorts("0.0.0.0:8080->80/tcp, :::8080->80/tcp")).toEqual([8080]);
    expect(parsePublishedPorts("0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp")).toEqual([3000]);
    expect(parsePublishedPorts("127.0.0.1:5432->5432/tcp")).toEqual([5432]);
  });

  it("expands host port ranges", () => {
    expect(parsePublishedPorts("0.0.0.0:8000-8002->8000-8002/tcp")).toEqual([8000, 8001, 8002]);
  });

  it("skips ports that are not published and UDP ports", () => {
    expect(parsePublishedPorts("80/tcp, 443/tcp")).toEqual([]);
    expect(parsePublishedPorts("0.0.0.0:53->53/udp")).toEqual([]);
    expect(parsePublishedPorts("")).toEqual([]);
  });

  it("keeps several published ports in order", () => {
    expect(parsePublishedPorts("0.0.0.0:9090->9090/tcp, 0.0.0.0:3001->3000/tcp, 6379/tcp")).toEqual(
      [3001, 9090],
    );
  });
});

describe("parseDockerPs", () => {
  it("reads name, image, compose labels and published ports from each JSON line", () => {
    const text = [
      line({
        Names: "acme-api-1",
        Image: "acme/api:dev",
        Labels: "com.docker.compose.project=acme,com.docker.compose.service=api,other=x",
        Ports: "0.0.0.0:3000->3000/tcp, :::3000->3000/tcp",
      }),
      line({ Names: "blog", Image: "nginx:1.27", Labels: "", Ports: "0.0.0.0:8080->80/tcp" }),
      "",
    ].join("\n");
    expect(parseDockerPs(text)).toEqual([
      {
        name: "acme-api-1",
        image: "acme/api:dev",
        composeProject: "acme",
        composeService: "api",
        ports: [3000],
      },
      {
        name: "blog",
        image: "nginx:1.27",
        composeProject: null,
        composeService: null,
        ports: [8080],
      },
    ]);
  });

  it("skips lines that are not JSON or have no usable name", () => {
    const text = ["not json", line({ Image: "x" }), line({ Names: "bad name;", Image: "x" })].join(
      "\n",
    );
    expect(parseDockerPs(text)).toEqual([]);
  });

  it("takes the first of several names", () => {
    const [container] = parseDockerPs(line({ Names: "web,link/alias", Image: "x", Ports: "" }));
    expect(container?.name).toBe("web");
  });
});

describe("isContainerName", () => {
  it("accepts Docker names and refuses anything a shell or flag parser could read", () => {
    expect(isContainerName("acme-api-1")).toBe(true);
    expect(isContainerName("a.b_c")).toBe(true);
    expect(isContainerName("-rm")).toBe(false);
    expect(isContainerName("a b")).toBe(false);
    expect(isContainerName("")).toBe(false);
  });
});

describe("containerProjectInfo", () => {
  it("names a compose container after its service and project", () => {
    const info = containerProjectInfo({
      name: "acme-api-1",
      image: "acme/api",
      composeProject: "acme",
      composeService: "api",
      ports: [3000],
    });
    expect(suggestName(info)).toBe("api.acme");
  });

  it("names any other container after itself", () => {
    const info = containerProjectInfo({
      name: "My_Blog",
      image: "nginx",
      composeProject: null,
      composeService: null,
      ports: [8080],
    });
    expect(suggestName(info)).toBe("my-blog");
  });
});
