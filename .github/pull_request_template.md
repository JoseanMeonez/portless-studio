## What changed and why

<!-- The problem this solves and how. Link the issue: "Closes #123". -->

## How to review

<!-- What to look at first, and anything out of scope. -->

## Checklist

- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm smoke` pass
- [ ] Tests cover the behavior change, next to the code
- [ ] Help text in `src/cli/cli-args.ts` and the pages in `docs/` match any new or changed
      command, flag or config field
- [ ] No data from my machine in code, tests, screenshots or docs (paths, hostnames, user names,
      real route or project names)
- [ ] Commits follow Conventional Commits with a scope, such as `fix(server): ...`
