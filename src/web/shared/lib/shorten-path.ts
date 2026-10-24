const HOME = /^(\/home\/[^/]+|\/Users\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=[/\\]|$)/;
const MAX_PARTS = 5;
const KEPT_PARTS = 3;

/**
 * A folder path short enough for a table cell: the home folder becomes `~`, and a deep path keeps
 * only its last folders, which are the ones that tell projects apart.
 */
export function shortenPath(path: string): string {
  const short = path.replace(HOME, "~");
  const separator = short.includes("\\") && !short.includes("/") ? "\\" : "/";
  const parts = short.split(separator).filter((part, index) => part !== "" || index === 0);
  if (parts.length <= MAX_PARTS) return short;
  return ["…", ...parts.slice(-KEPT_PARTS)].join(separator);
}
