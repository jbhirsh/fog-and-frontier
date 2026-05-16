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

## Production error monitoring (issue #20)

Two layers, both off-by-default for local dev:

- **Serverless** — `api/_log.ts` wraps every `api/*.ts` handler in
  `withErrorLogging`. Unhandled throws and explicit 5xx branches emit a
  single-line JSON entry to stderr (`{ level, source, ts, route, method,
  status, err }`) so Vercel Observability can filter by route/status.
  Request bodies and the `Authorization` header are never logged; the Gemini
  API key only lives in outgoing URLs, which are not logged.
- **Client** — `src/lib/sentry.ts` initializes `@sentry/react` when
  `VITE_SENTRY_DSN` is present. `Sentry.ErrorBoundary` wraps the React tree
  in `src/main.tsx`. URL query strings are stripped from breadcrumbs and the
  event request URL as defense-in-depth (`scrubBreadcrumb` / `scrubEvent`).
  `sendDefaultPii: false` — no IP, no cookies, no user emails.
- **Tracing** — `Sentry.reactRouterV7BrowserTracingIntegration` captures
  page-load + route-change transactions through `BrowserRouter`. `App.tsx`
  wraps `Routes` with `Sentry.withSentryReactRouterV7Routing` so spans use
  parameterised path names (e.g. `/explore`) rather than concrete URLs.
  Sample rate is 10% in production (free-tier quota) and 100% in
  preview/dev for easier debugging.

### Env vars

| Var                          | Where                                | Purpose                                                                                              |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `VITE_SENTRY_DSN`            | Vercel (all envs)                    | Enables browser Sentry. Omit to disable (local dev).                                                  |
| `SENTRY_AUTH_TOKEN`          | Vercel (build env, all)              | Lets `@sentry/vite-plugin` upload source maps + register releases. Token needs `project:releases`.    |
| `VITE_VERCEL_ENV`            | Vite-injected from `VERCEL_ENV`      | `production` / `preview` / `development` → Sentry environment tag. Wired in `vite.config.ts` define. |
| `VITE_VERCEL_GIT_COMMIT_SHA` | Vite-injected from build env         | Tagged as Sentry release so frames symbolicate to the right upload. Wired in `vite.config.ts` define. |

### Source-map upload (de-minified stack traces)

`vite.config.ts` registers `sentryVitePlugin` whenever `SENTRY_AUTH_TOKEN` is
set. Build flow:

1. Vite emits hidden source maps (`build.sourcemap: 'hidden'`) — the JS bundle
   carries no `//# sourceMappingURL` comment, so browsers never fetch the maps.
2. The Sentry plugin uploads the `.map` files to Sentry, tagged with the
   release (the Vercel commit SHA).
3. `filesToDeleteAfterUpload` removes the `.map` files from `dist/` before
   Vercel publishes the build — maps live on Sentry only, not on the public CDN.

To create the auth token: *Sentry → Settings → Auth Tokens → Create New Token →
scope `project:releases`*.

### GitHub ↔ Sentry source linking (one-time)

The Sentry GitHub integration ties stack frames to source on `main`. To set up:

1. *Sentry → Settings → Integrations → GitHub* — install the app on
   `jbhirsh/fog-and-frontier` (or "All repositories"). Verify on
   *github.com/settings/installations*.
2. *Sentry GitHub integration → Configurations → Code Mappings* — add
   `fog_and_frontier` project, repo `jbhirsh/fog-and-frontier`, branch `main`,
   source root `./`. Stack trace root depends on what frames look like after
   source-map upload (typically `~/` for Vite browser builds).

Once mapped, issue stack frames link directly to source on GitHub and the
Sentry-bot leaves PR comments when a PR touches code with open issues.

### Weekly digest / alerts (acceptance criterion)

- **Vercel** — configure under *Project → Observability → Alerts* to email on
  5xx-rate spikes from `/api/*`.
- **Sentry** — *Project Settings → Alerts → Issue Owners* + the default weekly
  digest email cover "what broke this week" without a manual sweep.
