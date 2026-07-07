# Contributing / Developer notes

Deep implementation notes for working in this repo. For the project overview and
screenshots, see [`README.md`](./README.md). For AI-assistant working
conventions, see [`CLAUDE.md`](./CLAUDE.md).

## Local development

```sh
npm ci --legacy-peer-deps   # ESLint 10 has peer-range mismatches with some plugins
npm run dev                  # Vite, port 5173 by default
```

The UI boots without any secrets: with no `VITE_CLERK_PUBLISHABLE_KEY` set,
`src/lib/authShim.ts` falls back to a no-auth shim (every visitor is signed-out;
owner-gated controls are hidden).

The Apollo client calls the API at the relative path `/api/graphql`, and plain
`vite` doesn't serve it. For local data, run `vercel dev` (which serves the
serverless function) — or point `DEV_DB_PATH` at a local SQLite snapshot (see
`scripts/snapshot-prod-db.mjs`) so the function reads from a file instead of
Turso. Copy `.env.local.example` to `.env.local` and fill in the keys you need.

## Lint, type-check, build, test

| Command                  | What it does                                                          |
| ------------------------ | -------------------------------------------------------------------- |
| `npm run lint`           | `eslint .` + `stylelint src/**/*.css` (CI gate)                       |
| `npm run lint:js`        | ESLint only                                                           |
| `npm run lint:css`       | Stylelint only                                                        |
| `npm run lint:fix`       | Auto-fixers for both (review the CSS diff before committing — see below) |
| `npm run typecheck`      | `tsc -b` across the `app`, `node`, and `api` projects                 |
| `npm run codegen`        | `graphql-codegen` → typed operations in `src/gql/`                    |
| `npm run build`          | `lint` → `tsc -b` → `vite build`                                      |
| `npm run test`           | Vitest unit tests                                                     |
| `npm run test:visual`    | Playwright visual regression against a `--mode test` `vite preview`   |

### Lint policy — no rule suppressions

ESLint runs type-checked (`tseslint.configs.recommendedTypeChecked`) with
`jsx-a11y`, `import/no-cycle`, `no-floating-promises`, and `no-misused-promises`
enabled. **Per project policy there are no rule suppressions** — no
`eslint-disable`, no `@ts-ignore`/`@ts-expect-error`, and no downgrading a rule in
config to make a violation pass. Fix the underlying code instead. (Many of the
type-level fixes this policy forced are written up in `CALIBER_LEARNINGS.md`.)

### Three TypeScript projects

`tsc -b` builds three referenced projects (`tsconfig.json` is the solution file)
so the type-aware ESLint rules get correct lib/DOM types per surface:

- `tsconfig.app.json` — `src/**/*.{ts,tsx}` (DOM + Vitest globals)
- `tsconfig.api.json` — `api/**/*.ts` (Node, no DOM; `strict`)
- `tsconfig.node.json` — `vite.config.ts` and tooling

> Gotcha: a Vercel build can fail with `TS2550: Property 'cause' does not exist on
> type 'Error'` even when a clean local `tsc -b` passes, because Vercel builds from
> a cache-free install. `tsconfig.api.json` therefore pins `"lib": ["ES2022",
> "ES2023"]` explicitly. Don't trust a green local typecheck as proof Vercel will
> build.

### CSS caveat — don't blindly `--fix`

`src/index.css` uses Tailwind v4's `@theme` / `@utility` / `@layer` directives.
Stylelint is intentionally configured with only `stylelint-config-recommended`
(structural rules), not the stylistic `--standard` preset, because a prior
auto-fix pass on this file produced broken output in production (see `PLAN.md`).
If you run `lint:fix`, eyeball the CSS diff and let the visual-regression suite
verify the built CSS in `dist/assets/*.css` before merging.

## Architecture notes

### GraphQL: one serverless function (issue #91)

Every former REST endpoint now lives behind a single Apollo Server handler at
`api/graphql.ts`, permanently clearing Vercel Hobby's 12-function cap. It runs
Apollo Server 5 on Express 5 (`@as-integrations/express5`); the schema (SDL) is
`api/_schema.ts` and resolvers live in `api/_resolvers/*`. The client uses Apollo
Client 4 with `graphql-codegen`'s client-preset (`src/gql/`, a generated
artifact excluded from the strict app typecheck roots).

- API handlers use Node-style `(req, res)` signatures (`@vercel/node`). Web-API
  style hangs in `vercel dev`. `graphql.ts` exports the bare Express app so
  `@vercel/node` detects `.listen` and skips its own body parser.
- libsql row values are typed as `InValue` (a union including binary/Date). When
  reading the `id` column, narrow with `typeof === 'string' | 'number' |
  'bigint'` before stringifying — don't `String(row.id)`, which can drop rows or
  stringify Buffers to `"[object ArrayBuffer]"`. (This exact bug once shipped to
  prod — see `PLAN.md`.)

### Auth model

- **Server is the real gate.** `requireOwner` in `api/_auth.ts` (Clerk-backed)
  enforces every mutating endpoint and paid call (e.g. Gemini).
- Client-side, `useOwner()` in `src/lib/useOwner.ts` is a UI hint only. Owner
  emails come from `VITE_OWNER_EMAILS`; keep it in sync with the server's
  `OWNER_EMAILS`.
- **Role-gated UI convention (issue #67):** owner-guarded *mutating* controls are
  **hidden** from non-owners, not disabled/greyed. The full convention (and the
  exceptions — sign-in-gated and trip-creator-gated controls) is documented in
  [`CLAUDE.md`](./CLAUDE.md).

### Production error monitoring (issue #20)

Two layers, both off-by-default for local dev:

- **Serverless** — `api/_log.ts` emits a single-line JSON entry to stderr
  (`{ level, source, ts, route, method, status, err }`) for unhandled throws and
  non-user GraphQL errors, so Vercel Observability can filter by route/status.
  Request bodies and the `Authorization` header are never logged; the Gemini API
  key only lives in outgoing URLs, which are not logged.
- **Client** — `src/lib/sentry.ts` initializes `@sentry/react` when
  `VITE_SENTRY_DSN` is present. `Sentry.ErrorBoundary` wraps the React tree in
  `src/main.tsx`. URL query strings are stripped from breadcrumbs and the event
  request URL as defense-in-depth (`scrubBreadcrumb` / `scrubEvent`).
  `sendDefaultPii: false` — no IP, no cookies, no user emails.
- **Tracing** — `Sentry.reactRouterV7BrowserTracingIntegration` captures
  page-load + route-change transactions; `App.tsx` wraps `Routes` with
  `Sentry.withSentryReactRouterV7Routing` so spans use parameterised path names
  (e.g. `/explore`). Sample rate is 10% in production (free-tier quota), 100% in
  preview/dev.

#### Source-map upload (de-minified stack traces)

`vite.config.ts` registers `sentryVitePlugin` whenever `SENTRY_AUTH_TOKEN` is
set:

1. Vite emits hidden source maps (`build.sourcemap: 'hidden'`) — no
   `//# sourceMappingURL` comment, so browsers never fetch the maps.
2. The Sentry plugin uploads the `.map` files, tagged with the release (the
   Vercel commit SHA).
3. `filesToDeleteAfterUpload` removes the `.map` files from `dist/` before Vercel
   publishes — maps live on Sentry only, not the public CDN.

Create the auth token at *Sentry → Settings → Auth Tokens* with scope
`project:releases`.

#### GitHub ↔ Sentry source linking (one-time)

1. *Sentry → Settings → Integrations → GitHub* — install the app on this repo.
2. *Sentry GitHub integration → Configurations → Code Mappings* — add the project,
   branch `main`, source root `./`. Stack-trace root is typically `~/` for Vite
   browser builds. Once mapped, issue frames link to source on GitHub and the
   Sentry bot comments on PRs touching code with open issues.

#### Alerts / weekly digest

- **Vercel** — *Project → Observability → Alerts* to email on 5xx-rate spikes
  from `/api/*`.
- **Sentry** — *Project Settings → Alerts → Issue Owners* + the default weekly
  digest.

### Sentry env vars

| Var                          | Where                            | Purpose                                                             |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `VITE_SENTRY_DSN`            | Vercel (all envs)                | Enables browser Sentry. Omit to disable (local dev).               |
| `SENTRY_AUTH_TOKEN`          | Vercel (build env, all)          | Lets `@sentry/vite-plugin` upload source maps (`project:releases`). |
| `VITE_VERCEL_ENV`            | Vite-injected from `VERCEL_ENV`  | Sentry environment tag. Wired in `vite.config.ts` `define`.        |
| `VITE_VERCEL_GIT_COMMIT_SHA` | Vite-injected from build env     | Tagged as the Sentry release so frames symbolicate correctly.      |

## CI

Two GitHub Actions workflows guard `main` (both live at the repo root — Actions
only reads `.github/workflows/` there):

- **Smoke gate** (`.github/workflows/smoke.yml`) — waits for the Vercel
  deployment matching the head SHA, then runs `scripts/smoke.mjs` canary checks
  (`/api/graphql` returns real data, the HTML links a built CSS asset). It
  detects and retries Vercel's occasional no-build cached-stub deployments and
  fails with an actionable message. Re-runs against prod after merge.
- **Visual regression** (`.github/workflows/visual.yml`) — Playwright
  `toHaveScreenshot()` on desktop (1280×800) and mobile (390×844). Baselines
  live under `tests/visual/**/*-snapshots/` and are only regenerated via an
  explicit `workflow_dispatch` with `update_snapshots=true` — never auto-committed
  onto a PR branch.

## Product context lives in GitHub issues

Issues carry the full rationale — scope decisions, cross-feature coordination,
acceptance criteria — and reference each other (e.g. "coordinates with #16",
"supersedes #7"). Check `gh issue list` / `gh issue view <n>` before designing a
feature; the codebase alone won't tell you *why* something was built a certain
way. `PLAN.md` captures a multi-issue production-safety-net effort (#10–#12).

## Commit / PR conventions

- Conventional-commit style subjects (`feat(map): …`, `fix(trips): …`).
- Squash noisy commits (fixups, reverts, "address review") into clean, atomic
  commits before opening a PR.
- No rule suppressions (see above) — this is a hard project rule.
