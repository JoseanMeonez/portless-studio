import { HttpTerminalsGateway } from "./http-terminals-gateway.ts";

type FakeSource = {
  url: string;
  listeners: Map<string, (event: MessageEvent<string>) => void>;
  onerror: (() => void) | null;
  closed: boolean;
  emit(type: string, data: unknown): void;
};

function setup() {
  const sources: FakeSource[] = [];
  const requests: { url: string; init: RequestInit }[] = [];
  const gateway = new HttpTerminalsGateway({
    reconnectMs: 1,
    fetch: async (input, init) => {
      const url = String(input);
      requests.push({ url, init: init ?? {} });
      if (url === "/api/session") return new Response(JSON.stringify({ token: "tok" }));
      return new Response(JSON.stringify({ id: "t1" }), { status: 200 });
    },
    createEventSource: (url) => {
      const source: FakeSource = {
        url,
        listeners: new Map(),
        onerror: null,
        closed: false,
        emit: (type, data) =>
          source.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) })),
      };
      sources.push(source);
      return {
        addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) =>
          source.listeners.set(type, listener),
        close: () => {
          source.closed = true;
        },
        set onerror(handler: () => void) {
          source.onerror = handler;
        },
      } as unknown as EventSource;
    },
  });
  return { gateway, sources, requests };
}

describe("HttpTerminalsGateway", () => {
  it("sends the token with every request", async () => {
    const { gateway, requests } = setup();
    await gateway.input("t1", "ls\r");
    const input = requests.find((request) => request.url === "/api/terminals/t1/input");
    const headers = (input?.init.headers ?? {}) as Record<string, string>;
    expect(headers["x-portless-studio-token"]).toBe("tok");
    expect(input?.init.body).toBe(JSON.stringify({ text: "ls\r" }));
  });

  it("streams with the token in the query and resumes after the last character shown", async () => {
    const { gateway, sources } = setup();
    const seen: string[] = [];
    const stop = gateway.stream("t1", 0, {
      onOutput: (chunk) => seen.push(`${chunk.seq}:${chunk.data}`),
      onStatus: () => {},
    });
    await vi.waitFor(() => expect(sources).toHaveLength(1));
    expect(sources[0]?.url).toBe("/api/terminals/t1/stream?token=tok&from=0");
    sources[0]?.emit("output", { seq: 0, data: "hello" });
    sources[0]?.onerror?.();
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    expect(sources[1]?.url).toBe("/api/terminals/t1/stream?token=tok&from=5");
    // A replay that overlaps what was shown adds only the new part.
    sources[1]?.emit("output", { seq: 3, data: "lo world" });
    expect(seen).toEqual(["0:hello", "5: world"]);
    stop();
    expect(sources[1]?.closed).toBe(true);
  });
});
