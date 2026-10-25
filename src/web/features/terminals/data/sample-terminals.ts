import { InMemoryTerminalsGateway } from "./in-memory-terminals-gateway.ts";

const MAIN = { project: "acme-monorepo", worktree: null, branch: "main" };
const FALCON = { project: "acme-monorepo", worktree: "falcon", branch: "fix/dark-mode" };
const MAIN_PATH = "/home/dev/code/acme";
const FALCON_PATH = "/home/dev/code/acme-falcon";
const RESEARCH_PATH = "/home/dev/code/acme-research";

const VITE = (port: number) =>
  `\r\n  \u001b[35m\u001b[1mVITE\u001b[22m v6.0.0\u001b[39m  \u001b[2mready in\u001b[22m \u001b[1m318\u001b[22m ms\r\n\r\n  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:${port}/\u001b[39m\r\n`;

/**
 * Terminals for `?demo`, matching the sample routes: dev servers in the main checkout and the
 * falcon worktree, a failed test run, a shell, and one stopped by a Studio restart.
 */
export function createSampleTerminals(now: () => number = Date.now): InMemoryTerminalsGateway {
  const gateway = new InMemoryTerminalsGateway(now);
  const add = (cwd: string, command: string, title?: string) => {
    void gateway.create({ cwd, command, ...(title ? { title } : {}) });
  };
  add(MAIN_PATH, "pnpm --filter web dev", "web");
  add(MAIN_PATH, "pnpm --filter api dev", "api");
  add(MAIN_PATH, "pnpm test --filter web", "web tests");
  add(FALCON_PATH, "pnpm storybook", "storybook");
  add(FALCON_PATH, "");
  gateway.update("t1", {
    ...MAIN,
    ports: [{ port: 3000, route: "web.acme", url: "http://web.acme.localhost:1355" }],
  });
  gateway.write("t1", VITE(3000));
  gateway.update("t2", {
    ...MAIN,
    ports: [{ port: 4000, route: "api.acme", url: "http://api.acme.localhost:1355" }],
  });
  gateway.write("t2", "\u001b[32m[api]\u001b[39m listening on :4000\r\n");
  gateway.update("t3", MAIN);
  gateway.write(
    "t3",
    " \u001b[31m✗\u001b[39m src/cart.test.ts > applies the coupon\r\n   \u001b[31mexpected 90 to be 81\u001b[39m\r\n",
  );
  gateway.finish("t3", 1);
  gateway.update("t4", {
    ...FALCON,
    ports: [{ port: 6006, route: "storybook", url: "http://storybook.localhost:1355" }],
  });
  gateway.write("t4", "\u001b[32minfo\u001b[39m Storybook started on http://localhost:6006\r\n");
  gateway.update("t5", FALCON);
  gateway.addStopped({
    cwd: RESEARCH_PATH,
    command: "pnpm docs:dev",
    title: "docs",
    project: "acme-monorepo",
  });
  gateway.update("t6", { worktree: "research", branch: "feat/ACME-42-search" });
  gateway.recent = {
    [MAIN_PATH]: ["pnpm --filter web dev", "pnpm --filter api dev", "pnpm test --filter web"],
    [FALCON_PATH]: ["pnpm storybook", "pnpm lint"],
  };
  return gateway;
}
