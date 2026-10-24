import type { DetectedPort } from "../../../../core/ports/detected-port.ts";
import type { Route } from "../../../../core/routes/route.ts";

/** Every word of the query must appear in the name, URL, port or kind. Projects have chips. */
export function filterRoutes(routes: readonly Route[], query: string): Route[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...routes];
  return routes.filter((route) => {
    const text = `${route.name} ${route.url} ${route.port} ${route.kind}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Same rule for detected ports, over the port, process, folder and suggested name; by port. */
export function filterDetected(detected: readonly DetectedPort[], query: string): DetectedPort[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return detected
    .filter((item) => {
      const text =
        `${item.port} ${item.processName} ${item.cwd ?? ""} ${item.suggestedName ?? ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => a.port - b.port);
}
