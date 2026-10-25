/**
 * The address a dev server answers on without the portless proxy, e.g. `http://localhost:3000`.
 * For a Docker container it is the host port the container publishes.
 */
export function directUrl(port: number): string {
  return `http://localhost:${port}`;
}
