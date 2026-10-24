import {
  createSampleSnapshot,
  HttpRoutesGateway,
  InMemoryRoutesGateway,
  type RoutesGateway,
} from "../features/routes/index.ts";

/** `?demo` in the URL shows sample routes without a server; otherwise the real API is used. */
export function createGateway(location: Pick<Location, "search">): RoutesGateway {
  if (new URLSearchParams(location.search).has("demo")) {
    return new InMemoryRoutesGateway(createSampleSnapshot(Date.now()));
  }
  return new HttpRoutesGateway();
}
