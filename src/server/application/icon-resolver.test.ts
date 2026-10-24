import { type IconFetcher, IconResolver } from "./icon-resolver.ts";

const PNG = "data:image/png;base64,AAAA";
const SVG = "data:image/svg+xml;base64,BBBB";

function fakeFetcher(answers: {
  served?: Record<number, string | null>;
  remote?: Record<string, string | null>;
  folders?: Record<string, string | null>;
}) {
  const calls = { served: [] as number[], remote: [] as string[] };
  const fetcher: IconFetcher = {
    served: async (port) => {
      calls.served.push(port);
      return answers.served?.[port] ?? null;
    },
    remote: async (url) => {
      calls.remote.push(url);
      return answers.remote?.[url] ?? null;
    },
    inFolder: (rootDir) => answers.folders?.[rootDir] ?? null,
  };
  return { fetcher, calls };
}

const subject = { port: 5173, pid: 10, project: "acme", rootDir: "/code/acme" };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("IconResolver", () => {
  it("uses the icon set for the project in the config first", async () => {
    const { fetcher } = fakeFetcher({ served: { 5173: PNG } });
    const resolver = new IconResolver(fetcher, () => {});
    expect(resolver.iconFor(subject, { acme: "🦊" })).toBe("🦊");
  });

  it("inlines a configured http(s) icon once the server fetched it", async () => {
    const url = "https://example.com/acme.png";
    const { fetcher, calls } = fakeFetcher({ remote: { [url]: PNG } });
    const loaded = vi.fn();
    const resolver = new IconResolver(fetcher, loaded);
    expect(resolver.iconFor(subject, { acme: url })).toBeNull();
    await flush();
    expect(loaded).toHaveBeenCalled();
    expect(resolver.iconFor(subject, { acme: url })).toBe(PNG);
    expect(calls.remote).toEqual([url]);
  });

  it("then the favicon the running server serves, fetched once per port and pid", async () => {
    const { fetcher, calls } = fakeFetcher({
      served: { 5173: PNG },
      folders: { "/code/acme": SVG },
    });
    const resolver = new IconResolver(fetcher, () => {});
    // While the fetch runs, the folder icon stands in.
    expect(resolver.iconFor(subject, {})).toBe(SVG);
    await flush();
    expect(resolver.iconFor(subject, {})).toBe(PNG);
    expect(resolver.iconFor(subject, {})).toBe(PNG);
    expect(calls.served).toEqual([5173]);
    resolver.iconFor({ ...subject, pid: 11 }, {});
    expect(calls.served).toEqual([5173, 5173]);
  });

  it("then a favicon in the project folder", async () => {
    const { fetcher } = fakeFetcher({ folders: { "/code/acme": SVG } });
    const resolver = new IconResolver(fetcher, () => {});
    resolver.iconFor(subject, {});
    await flush();
    expect(resolver.iconFor(subject, {})).toBe(SVG);
  });

  it("has no icon when nothing is found, so the page draws a monogram", async () => {
    const { fetcher } = fakeFetcher({});
    const loaded = vi.fn();
    const resolver = new IconResolver(fetcher, loaded);
    resolver.iconFor(subject, {});
    await flush();
    expect(resolver.iconFor(subject, {})).toBeNull();
    expect(loaded).not.toHaveBeenCalled();
    expect(
      resolver.iconFor({ port: 3000, pid: null, project: null, rootDir: null }, {}),
    ).toBeNull();
  });

  it("resolves a project's own icon from the config only", async () => {
    const { fetcher } = fakeFetcher({});
    const resolver = new IconResolver(fetcher, () => {});
    expect(resolver.configuredIcon("acme", { acme: "🦊" })).toBe("🦊");
    expect(resolver.configuredIcon("otter", { acme: "🦊" })).toBeNull();
  });
});
