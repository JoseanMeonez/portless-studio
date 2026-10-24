import {
  API_PATHS,
  SNAPSHOT_EVENT,
  type Snapshot,
  TOKEN_HEADER,
} from "../../../../core/api/contract.ts";
import { HttpRoutesGateway } from "./http-routes-gateway.ts";
import type { ConnectionState } from "./routes-gateway.ts";

const snapshot: Snapshot = {
  proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
  routes: [],
  readAt: 1,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; init: RequestInit };

function stubFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { calls, fetch: fetchStub as unknown as typeof fetch };
}

const header = (call: Call | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];

describe("HttpRoutesGateway writes", () => {
  it("fetches the session token once and sends it on every write", async () => {
    const { calls, fetch } = stubFetch((url) =>
      url === API_PATHS.session
        ? json(200, { token: "secret" })
        : new Response(null, { status: 204 }),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.createAlias({ name: "db", port: 5432 })).toEqual({
      ok: true,
      value: null,
    });
    expect(await gateway.removeAlias("db")).toEqual({ ok: true, value: null });

    const writes = calls.filter((call) => call.url !== API_PATHS.session);
    expect(calls.filter((call) => call.url === API_PATHS.session)).toHaveLength(1);
    expect(writes.map((call) => [call.init.method, call.url])).toEqual([
      ["POST", API_PATHS.aliases],
      ["DELETE", API_PATHS.alias("db")],
    ]);
    expect(writes.map((call) => header(call, TOKEN_HEADER))).toEqual(["secret", "secret"]);
    expect(JSON.parse(String(writes[0]?.init.body))).toEqual({ name: "db", port: 5432 });
  });

  it("returns the server's ApiError as a failed result", async () => {
    const { fetch } = stubFetch((url) =>
      url === API_PATHS.session
        ? json(200, { token: "secret" })
        : json(409, { error: "name_taken", message: "db is taken" }),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.renameAlias("db", { name: "postgres" })).toEqual({
      ok: false,
      error: { error: "name_taken", message: "db is taken" },
    });
  });

  it("asks for a new token once when the server rejects the cached one", async () => {
    let tokens = 0;
    const { calls, fetch } = stubFetch((url, init) => {
      if (url === API_PATHS.session) return json(200, { token: `token-${++tokens}` });
      return header({ url, init }, TOKEN_HEADER) === "token-2"
        ? new Response(null, { status: 204 })
        : json(403, { error: "forbidden", message: "bad token" });
    });
    const gateway = new HttpRoutesGateway({ fetch });

    expect((await gateway.removeAlias("db")).ok).toBe(true);
    expect(calls.filter((call) => call.url === API_PATHS.session)).toHaveLength(2);
  });

  it("reports an unreachable server as an internal error instead of throwing", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const gateway = new HttpRoutesGateway({ fetch });

    const result = await gateway.getSnapshot();
    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error.error).toBe("internal");
  });
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(name, listener);
  }

  close() {
    this.closed = true;
  }

  emit(name: string, data: string) {
    this.listeners.get(name)?.(new MessageEvent(name, { data }));
  }
}

describe("HttpRoutesGateway live updates", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const create = () =>
    new HttpRoutesGateway({
      createEventSource: (url) => new FakeEventSource(url) as unknown as EventSource,
      reconnectDelays: [100, 1000],
    });

  it("passes every snapshot event to the listener and ignores malformed ones", () => {
    const received: Snapshot[] = [];
    create().subscribe((value) => received.push(value));
    const source = FakeEventSource.instances[0];

    expect(source?.url).toBe(API_PATHS.events);
    source?.emit(SNAPSHOT_EVENT, JSON.stringify(snapshot));
    source?.emit(SNAPSHOT_EVENT, "not json");
    expect(received).toEqual([snapshot]);
  });

  it("reconnects with backoff after an error and reports the connection state", () => {
    const states: ConnectionState[] = [];
    const unsubscribe = create().subscribe(
      () => {},
      (state) => states.push(state),
    );

    FakeEventSource.instances[0]?.onopen?.();
    FakeEventSource.instances[0]?.onerror?.();
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    vi.advanceTimersByTime(99);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1]?.onopen?.();
    expect(states).toEqual(["connecting", "open", "reconnecting", "open"]);

    unsubscribe();
    expect(FakeEventSource.instances[1]?.closed).toBe(true);
  });
});
