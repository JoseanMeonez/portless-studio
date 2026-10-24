#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { type RunningServer, startServer } from "../server/main.ts";
import { HELP, parseCliArgs } from "./cli-args.ts";
import { openBrowser } from "./open-browser.ts";
import { registerStudioAlias, type StudioAlias, unregisterStudioAlias } from "./studio-alias.ts";

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`Error: ${parsed.error}\n\n${HELP}`);
    process.exit(1);
  }
  const options = parsed.value;
  if (options.command === "help") {
    console.log(HELP);
    return;
  }
  if (options.command === "version") {
    console.log(readVersion());
    return;
  }

  const webDir = resolveWebDir();
  let server: RunningServer;
  try {
    server = await startServer({ port: options.port, webDir });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(
      code === "EADDRINUSE"
        ? `Error: port ${options.port} is in use. Pick another one with --port.`
        : `Error: could not start the server: ${(error as Error).message}`,
    );
    process.exit(1);
  }

  const alias: StudioAlias = options.register
    ? await registerStudioAlias(server.registry, server.port)
    : { url: null, owned: false };

  console.log("portless-studio is running");
  if (alias.url) console.log(`  ${alias.url}`);
  console.log(`  ${server.url}`);
  if (alias.note) console.log(`  (no "studio" alias: ${alias.note})`);
  if (!webDir) console.log("  API only: the UI runs through `pnpm dev:web`.");

  if (options.open && webDir) openBrowser(alias.url ?? server.url);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (alias.owned) await unregisterStudioAlias(server.registry, server.port).catch(() => {});
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

/**
 * The built app sits next to the built CLI (`dist/web` beside `dist/cli`). Running the TypeScript
 * source means development, where Vite serves the UI.
 */
function resolveWebDir(): string | undefined {
  if (import.meta.url.endsWith(".ts")) return undefined;
  const dir = fileURLToPath(new URL("../web/", import.meta.url));
  return fs.existsSync(path.join(dir, "index.html")) ? dir : undefined;
}

function readVersion(): string {
  const file = new URL("../../package.json", import.meta.url);
  const pkg: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  const version = typeof pkg === "object" && pkg !== null ? Reflect.get(pkg, "version") : undefined;
  return typeof version === "string" ? version : "unknown";
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
