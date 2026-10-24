import {
  API_PATHS,
  type ConfigResponse,
  SNAPSHOT_EVENT,
  type Snapshot,
  STUDIO_EVENT,
  type StudioEvent,
  TOKEN_HEADER,
} from "../../../../core/api/contract.ts";
import { DEFAULT_CONFIG } from "../../../../core/config/studio-config.ts";
import { HttpRoutesGateway } from "./http-routes-gateway.ts";
import type { ConnectionState } from "./routes-gateway.ts";

const snapshot: Snapshot = {
  proxy: { running: true, port: 443, https: true, tlds: ["localhost"] },
  portless: { installed: true, version: "0.4.2" },
  routes: [],
  detected: [],
  autoName: false,
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

  it("installs portless with the token and returns the version and output", async () => {
    const { calls, fetch } = stubFetch((url) =>
      url === API_PATHS.session
        ? json(200, { token: "secret" })
        : json(200, { version: "0.4.2", output: "added 1 package" }),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.installPortless()).toEqual({
      ok: true,
      value: { version: "0.4.2", output: "added 1 package" },
    });
    const install = calls.find((call) => call.url === API_PATHS.installPortless);
    expect(install?.init.method).toBe("POST");
    expect(install && header(install, TOKEN_HEADER)).toBe("secret");
  });

  it("returns install_failed from the server as a failed result", async () => {
    const { fetch } = stubFetch((url) =>
      url === API_PATHS.session
        ? json(200, { token: "secret" })
        : json(502, { error: "install_failed", message: "npm exited with code 1." }),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.installPortless()).toEqual({
      ok: false,
      error: { error: "install_failed", message: "npm exited with code 1." },
    });
  });

  it("reads the config without a token", async () => {
    const body: ConfigResponse = { config: DEFAULT_CONFIG, path: "/home/dev/.studio.json" };
    const { calls, fetch } = stubFetch(() => json(200, body));
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.getConfig()).toEqual({ ok: true, value: body });
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([["GET", API_PATHS.config]]);
  });

  it("saves the config with PUT and the token, and returns what the server stored", async () => {
    const config = { ...DEFAULT_CONFIG, autoName: true, ignoredPorts: [9229] };
    const { calls, fetch } = stubFetch((url) =>
      url === API_PATHS.session
        ? json(200, { token: "secret" })
        : json(200, { config, path: "/home/dev/.studio.json" }),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.updateConfig(config)).toEqual({
      ok: true,
      value: { config, path: "/home/dev/.studio.json" },
    });
    const put = calls.find((call) => call.url === API_PATHS.config);
    expect(put?.init.method).toBe("PUT");
    expect(put && header(put, TOKEN_HEADER)).toBe("secret");
    expect(JSON.parse(String(put?.init.body))).toEqual(config);
  });

  it("returns invalid_config from the server as a failed result", async () => {
    const error = { error: "invalid_config", message: `"port" must be a whole number.` };
    const { fetch } = stubFetch((url) =>
      url === API_PATHS.session ? json(200, { token: "secret" }) : json(400, error),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.updateConfig(DEFAULT_CONFIG)).toEqual({ ok: false, error });
  });

  it("ignores a detected port with POST and the token", async () => {
    const { calls, fetch } = stubFetch((url) =>
      url === API_PATHS.session
        ? json(200, { token: "secret" })
        : new Response(null, { status: 204 }),
    );
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.ignoreDetected(5173)).toEqual({ ok: true, value: null });
    const ignore = calls.find((call) => call.url === API_PATHS.ignoreDetected(5173));
    expect(ignore?.init.method).toBe("POST");
    expect(ignore && header(ignore, TOKEN_HEADER)).toBe("secret");
  });

  it("reads a snapshot from an older server without detected ports", async () => {
    const { detected: _detected, autoName: _autoName, ...older } = snapshot;
    const { fetch } = stubFetch(() => json(200, older));
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.getSnapshot()).toEqual({ ok: true, value: snapshot });
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

describe("HttpRoutesGateway health and control", () => {
  const withToken = (respond: (url: string, init: RequestInit) => Response) =>
    stubFetch((url, init) =>
      url === API_PATHS.session ? json(200, { token: "t" }) : respond(url, init),
    );

  it("reads the doctor checks", async () => {
    const checks = [{ id: "portless", status: "ok", title: "portless 1 is installed", detail: "" }];
    const { fetch } = stubFetch(() => json(200, { checks }));
    const gateway = new HttpRoutesGateway({ fetch });
    expect(await gateway.getDoctor()).toEqual({ ok: true, value: { checks } });
  });

  it("runs a fix, a proxy action, a Studio action and a process stop with the token", async () => {
    const { calls, fetch } = withToken((url) => {
      if (url === API_PATHS.doctorFix("proxy-running")) {
        return json(200, { message: "Started", checks: [] });
      }
      if (url === API_PATHS.proxy("restart")) return json(200, { message: "Restarted" });
      if (url === API_PATHS.studio("stop")) {
        return json(202, { message: "Stopping", startCommand: "portless-studio" });
      }
      return new Response(null, { status: 204 });
    });
    const gateway = new HttpRoutesGateway({ fetch });

    expect(await gateway.runDoctorFix("proxy-running")).toEqual({
      ok: true,
      value: { message: "Started", checks: [] },
    });
    expect(await gateway.controlProxy("restart")).toEqual({
      ok: true,
      value: { message: "Restarted" },
    });
    expect(await gateway.controlStudio("stop")).toEqual({
      ok: true,
      value: { message: "Stopping", startCommand: "portless-studio" },
    });
    expect(await gateway.stopProcess(51)).toEqual({ ok: true, value: null });

    const writes = calls.filter((call) => call.url !== API_PATHS.session);
    expect(writes.map((call) => [call.init.method, call.url, header(call, TOKEN_HEADER)])).toEqual([
      ["POST", API_PATHS.doctorFix("proxy-running"), "t"],
      ["POST", API_PATHS.proxy("restart"), "t"],
      ["POST", API_PATHS.studio("stop"), "t"],
      ["POST", API_PATHS.stopProcess(51), "t"],
    ]);
  });

  it("keeps the command of a needs_admin error", async () => {
    const { fetch } = withToken(() =>
      json(409, {
        error: "needs_admin",
        message: "Runs as root.",
        command: "sudo portless proxy stop",
      }),
    );
    const gateway = new HttpRoutesGateway({ fetch });
    expect(await gateway.controlProxy("stop")).toEqual({
      ok: false,
      error: {
        error: "needs_admin",
        message: "Runs as root.",
        command: "sudo portless proxy stop",
      },
    });
  });
});

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

  it("passes every studio event to the event listener and ignores malformed ones", () => {
    const events: StudioEvent[] = [];
    create().subscribe(
      () => {},
      undefined,
      (event) => events.push(event),
    );
    const event: StudioEvent = {
      id: "r-1",
      kind: "named",
      title: "Named app",
      body: "Port 5173 opens at http://app.localhost",
      target: { route: "app", port: 5173 },
      at: 5,
    };
    const source = FakeEventSource.instances[0];
    source?.emit(STUDIO_EVENT, JSON.stringify(event));
    source?.emit(STUDIO_EVENT, JSON.stringify({ id: "x", kind: "nope" }));
    source?.emit(STUDIO_EVENT, "not json");
    expect(events).toEqual([event]);
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
