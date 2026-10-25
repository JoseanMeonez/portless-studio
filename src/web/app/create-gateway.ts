import {
  createSampleSnapshot,
  HttpRoutesGateway,
  InMemoryRoutesGateway,
  type RoutesGateway,
  SAMPLE_LATE_SERVER,
} from "../features/routes/index.ts";
import {
  createSampleTerminals,
  HttpTerminalsGateway,
  type TerminalsGateway,
} from "../features/terminals/index.ts";

const DEMO_LATE_SERVER_MS = 12_000;

/**
 * `?demo` in the URL shows sample routes without a server; `?demo&noportless` starts with portless
 * missing so the install flow can be tried. Otherwise the real API is used.
 */
export function createGateway(location: Pick<Location, "search">): RoutesGateway {
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) {
    const installed = !params.has("noportless");
    const gateway = new InMemoryRoutesGateway(
      createSampleSnapshot(Date.now(), installed),
      Date.now,
      { installDelayMs: 1500, events: true },
    );
    // Shows a new server appearing, which auto mode names when it is on.
    setTimeout(() => gateway.startServer(SAMPLE_LATE_SERVER), DEMO_LATE_SERVER_MS);
    return gateway;
  }
  return new HttpRoutesGateway();
}

/** The terminals backend that goes with `createGateway`: sample terminals in memory for `?demo`. */
export function createTerminalsGateway(location: Pick<Location, "search">): TerminalsGateway {
  return new URLSearchParams(location.search).has("demo")
    ? createSampleTerminals()
    : new HttpTerminalsGateway();
}
