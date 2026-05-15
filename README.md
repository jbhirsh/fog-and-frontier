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

## Environment variables

Server-side env vars (set in Vercel Project Settings, or via `vercel env pull`):

| Variable                          | Required | Purpose                                                                 |
| --------------------------------- | -------- | ----------------------------------------------------------------------- |
| `TURSO_DATABASE_URL`              | yes      | libsql URL for the environment's Turso DB.                              |
| `TURSO_AUTH_TOKEN`                | yes      | Turso auth token.                                                       |
| `CLERK_SECRET_KEY`                | yes      | Clerk backend secret for `requireOwner`.                                |
| `OWNER_EMAILS`                    | yes      | Comma-separated owner allow-list.                                       |
| `GEMINI_API_KEY`                  | yes      | Used by `/api/discover` and `/api/generate-activity`.                   |
| `GEMINI_DISCOVER_DAILY_LIMIT`     | no       | Max Gemini calls to `/api/discover` per UTC day. Default: 50 (issue #23). |
| `GEMINI_GENERATE_DAILY_LIMIT`     | no       | Max Gemini calls to `/api/generate-activity` per UTC day. Default: 200. |
| `DEV_DB_PATH`                     | no       | Local SQLite snapshot for offline dev (see `scripts/snapshot-prod-db.mjs`). |

The Gemini per-day counter is server-enforced in Turso (`gemini_usage` table)
so it survives Fluid Compute scale-out. The "day" key is UTC `YYYY-MM-DD` so
all instances roll over together and match Google Cloud's billing day.
Exceeding the limit returns `429 { error: "daily budget exceeded", resetsAt }`.
Each call logs `[gemini-budget] key=… count=… limit=… day=…` so today's usage
is queryable from Vercel logs without an admin endpoint.

The counter is incremented *before* the Gemini call, so a Gemini API failure
still consumes a budget slot. This is a deliberate fail-closed choice —
undercounting is the dangerous direction — but the practical effect is that
flaky Gemini days will burn through the daily limit faster than successful
days. Bump `GEMINI_*_DAILY_LIMIT` if that becomes a problem.
