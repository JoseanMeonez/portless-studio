# Code conventions

These keep the code predictable to read. Biome enforces the ones marked (lint).

## Files and names

- File names are kebab-case: `route-row.tsx`, `http-routes-gateway.ts` (lint).
- One React component per file, named like the file in PascalCase: `route-row.tsx` exports
  `RouteRow`.
- Named exports only, no `export default` (lint). Config files are the exception.
- Styles sit next to their component as a CSS module: `route-row.module.css`.
- Tests sit next to the code they test: `route-name.test.ts`.
- A feature exposes its public API through `index.ts`. Other folders import from there, never from
  a feature's internal files. No other barrel files.

## TypeScript

- `type` for data shapes, `interface` for ports (contracts an adapter implements).
- Relative imports include the extension: `import { parseRoute } from "./route.ts"`. Node runs the
  server source directly and the build rewrites them to `.js`.
- `import type` for type-only imports (lint).
- No `any`. Parse unknown input at the edge (files, HTTP bodies) into typed values once.
- Errors that a user can cause are values, not exceptions: functions return
  `{ ok: true, value } | { ok: false, error }` (see `core/result.ts`). Exceptions are for bugs.

## React

- Presentational components receive data and callbacks through props and do not fetch, read
  context or hold server state.
- Hooks hold behavior. Containers call hooks and render presentational components.
- No CSS-in-JS and no utility classes. Use the tokens in `styles/tokens.css` through
  `var(--...)`, never raw colors or pixel values that a token already covers.

## Comments

- Comment why, not what. One line is usually enough.
- No commented-out code and no change history in comments.

## Commits

Conventional Commits with a scope: `feat(web): add command menu`, `fix(server): reject foreign
origins`. No AI attribution.
