# Fog and Frontier

Bay Area activities tracker. React + Vite app deployed on Vercel, with serverless
API routes in `api/` and a Turso-hosted libsql database.

## Local development

```sh
npm ci --legacy-peer-deps   # ESLint 10 has peer-range mismatches with some plugins
npm run dev                  # vite, port 5173 by default
```

For routes that hit `/api/*`, use `vercel dev` (or set `DEV_DB_PATH` to a local
SQLite snapshot — see `scripts/snapshot-prod-db.mjs`).

## Lint, type-check, build, test

| Command                  | What it does                                                 |
| ------------------------ | ------------------------------------------------------------ |
| `npm run lint`           | `eslint .` + `stylelint src/**/*.css` (CI gate)              |
| `npm run lint:js`        | ESLint only                                                  |
| `npm run lint:css`       | Stylelint only                                               |
| `npm run lint:fix`       | Auto-fixers for both (review diff before committing CSS — see below) |
| `npm run typecheck`      | `tsc -b` against `app`, `node`, and `api` projects           |
| `npm run build`          | `lint` → `typecheck` → `vite build`                          |
| `npm run test`           | Vitest unit tests                                            |
| `npm run test:visual`    | Playwright visual regression against `vite preview`          |

ESLint is type-checked (`tseslint.configs.recommendedTypeChecked`) with
`jsx-a11y`, `import/no-cycle`, `no-floating-promises`, and `no-misused-promises`
enabled. Per project policy, **no rule suppressions** — fix the underlying code
when ESLint flags something. Three TS projects feed the type-aware rules:

- `tsconfig.app.json` — `src/**/*.{ts,tsx}` (DOM + vitest)
- `tsconfig.api.json` — `api/**/*.ts` (Node, no DOM)
- `tsconfig.node.json` — `vite.config.ts`, tooling

### CSS caveat — don't blindly `--fix`

`src/index.css` uses Tailwind v4's `@theme` / `@utility` / `@layer` directives.
Stylelint is intentionally configured with only `stylelint-config-recommended`
(structural rules), not the stylistic `--standard` preset, because a prior
auto-fix pass on this file produced broken output in production (see PLAN.md).
If you run `lint:fix`, eyeball the CSS diff and verify the built CSS in
`dist/assets/*.css` against the visual regression suite before merging.

## Architecture notes

- API handlers use Node-style `(req, res)` signatures (`@vercel/node`). Web-API
  style hangs in `vercel dev`.
- libsql row values are typed as `InValue` (a union including binary/Date). When
  reading the `id` column, narrow with `typeof === 'string' | 'number' | 'bigint'`
  before stringifying — don't `String(row.id)`, which can drop rows or stringify
  Buffers to `"[object ArrayBuffer]"`.
- Owner-gated routes live behind `requireOwner` in `api/_auth.ts` (Clerk).
  Client-side, `useOwner()` is a UI hint only — the server is the gate.
