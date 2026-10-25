export type ProcessEntry = { pid: number; parent: number; command: string };

function devRunner(command: string): boolean {
  const words = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  const basename = (word: string) =>
    word
      .replace(/^['"]|['"]$/g, "")
      .split(/[/\\]/)
      .pop() ?? "";
  const executable = basename(words[0] ?? "");
  const script = /^(?:node|node.exe|bun|bun.exe)$/.test(executable)
    ? basename(words[1] ?? "")
    : executable;
  return /^(?:pnpm|npm(?:-cli)?|npx(?:-cli)?|yarn|bun|bunx|turbo|vite|next|astro|wrangler|ng|nuxt|remix|nodemon|tsx)(?:\.(?:c?js|mjs|exe|cmd))?$/i.test(
    script,
  );
}

function commandShell(command: string): boolean {
  const words = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  const name = (words[0] ?? "")
    .replace(/^['"]|['"]$/g, "")
    .split(/[/\\]/)
    .pop()
    ?.toLowerCase();
  if (name === "cmd.exe" || name === "cmd") {
    const commandAt = words.findIndex((word) => /^\/c$/i.test(word));
    return (
      commandAt > 0 &&
      commandAt < words.length - 1 &&
      words.slice(1, commandAt).every((word) => /^\/[dsq]$/i.test(word))
    );
  }
  return /^(?:sh|bash|zsh|dash)$/.test(name ?? "") && words[1] === "-c";
}

/** Root first prevents supervisors restarting children; the remaining children are deepest first. */
export function devProcessTree(pid: number, table: ProcessEntry[]): number[] {
  const byPid = new Map(table.map((entry) => [entry.pid, entry]));
  let root = byPid.get(pid);
  if (!root) return [];
  const seen = new Set([pid]);
  for (let depth = 0; depth < 64; depth++) {
    let parent = byPid.get(root.parent);
    if (!parent || parent.pid <= 1 || seen.has(parent.pid)) break;
    seen.add(parent.pid);
    if (commandShell(parent.command)) {
      parent = byPid.get(parent.parent);
      if (!parent || parent.pid <= 1 || seen.has(parent.pid)) break;
      seen.add(parent.pid);
    }
    if (!devRunner(parent.command)) break;
    root = parent;
  }
  const descendants = new Set([root.pid]);
  const ordered = [root.pid];
  for (let depth = 0; depth < 64; depth++) {
    const added = table.filter(
      (entry) => !descendants.has(entry.pid) && descendants.has(entry.parent),
    );
    if (!added.length) break;
    for (const entry of added) {
      descendants.add(entry.pid);
      ordered.push(entry.pid);
    }
  }
  return [root.pid, ...ordered.slice(1).reverse()];
}

export function parseProcessTable(output: string): ProcessEntry[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    return match
      ? [{ pid: Number(match[1]), parent: Number(match[2]), command: match[3] ?? "" }]
      : [];
  });
}
