# Contributing

Thanks for helping. Bug reports, fixes and small features are welcome; for a larger change, open
an issue first so we can agree on the approach before you write it.

## Setup

You need Node 24 or later and pnpm (the version is pinned in `packageManager` in `package.json`;
`corepack enable` installs it).

```bash
git clone https://github.com/keven-bardales/portless-studio
cd portless-studio
pnpm install
pnpm dev          # API on :4949 and the web app with hot reload on :5173
```

Open `http://localhost:5173/?demo` to work on the page with sample data and no portless at all.

## Before you open a pull request

Run the same checks CI runs on Linux, macOS and Windows:

```bash
pnpm check        # Biome lint and format check (pnpm format fixes most of it)
pnpm typecheck
pnpm test
pnpm build
pnpm smoke        # starts the built CLI on a free port and checks the API answers
```

Add a test with every behavior change, next to the code it covers (`*.test.ts` or
`*.test.tsx`). When you add or change a command, flag or config field, update the help text in
`src/cli/cli-args.ts`, the README and the page in `docs/` that covers it.

## Conventions

Code layout, naming and commit format are in [docs/conventions.md](docs/conventions.md), and the
layers are explained in [docs/architecture.md](docs/architecture.md). Commits follow Conventional
Commits with a scope, such as `fix(server): reject foreign origins`.

## Keep your machine out of the repository

Screenshots, test fixtures, logs and examples must not contain data from your own machine: real
route names, project or company names, folder paths, hostnames, usernames or emails. Use the
sample data the page shows with `?demo` for screenshots, and generic names (`acme`, `web.myapp`,
`/home/dev/code/...`) in tests and docs. Check your diff for these before you push.
