import {
  createSampleSnapshot,
  HttpRoutesGateway,
  InMemoryRoutesGateway,
  type RoutesGateway,
} from "../features/routes/index.ts";

/**
 * `?demo` in the URL shows sample routes without a server; `?demo&noportless` starts with portless
 * missing so the install flow can be tried. Otherwise the real API is used.
 */
export function createGateway(location: Pick<Location, "search">): RoutesGateway {
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) {
    const installed = !params.has("noportless");
    return new InMemoryRoutesGateway(createSampleSnapshot(Date.now(), installed), Date.now, {
      installDelayMs: 1500,
    });
  }
  return new HttpRoutesGateway();
}
