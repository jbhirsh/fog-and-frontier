# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project

**Fog and Frontier** — a personal West Coast adventures app. Vite + React 19 + TypeScript on the front end, Vercel serverless functions in `api/`, Turso (libSQL) for persistence, Clerk for auth, Leaflet for maps.

Not a Next.js project. Not Edge runtime. The deployed API is a **single Vercel serverless function** — `api/graphql.ts`, an Apollo Server on Express (issue #91) — with the schema in `api/_schema.ts` and resolvers in `api/_resolvers/*`. The `api/_*.ts` files are its helpers, not separate functions. New function-style handlers, if any, must be Node-style `(req, res)`.

## Scripts

- `npm run dev` — Vite dev server. For full-stack local dev (API + client) use `vercel dev`.
- `npm run build` — `lint`, then `tsc -b`, then `vite build`.
- `npm run codegen` — `graphql-codegen` → typed GraphQL operations in `src/gql/`.
- `npm run lint` — ESLint flat config.
- `npm test` / `test:watch` / `test:coverage` — Vitest.
- `npm run test:mutation` — StrykerJS over the files the coverage gate measures (`stryker.config.json`).
- `npm run test:visual` — Playwright visual regression.
- `npm run db:snapshot` / `db:seed-preview` / `db:migrate-static` — Turso helpers in `scripts/`.
- `npm run links:check` — audit every outbound link in the live catalog (#68): dead links fail it, bot-blocked ones (AllTrails) are listed for checking by hand. Runs weekly in `links.yml`.

## Layout

- `src/` — React app. `src/pages/`, `src/components/`, `src/lib/`, `src/data/types.ts` (Activity model).
- `api/` — the GraphQL function. `graphql.ts` is the handler; `_schema.ts` is the SDL; `_resolvers/*` implement it. `_gqlContext.ts` has the server auth gates (`requireOwnerCtx`, `requireMemberCtx` / `requireCreatorCtx` for trips, and `requireUserCtx` for any signed-in account), built on the Clerk token check in `_auth.ts`; `_db.ts` is the Turso client.
- `public/` — static assets.
- `scripts/` — DB / migration helpers (Node, `--experimental-strip-types` for `.mts/.ts`).
- `tests/` — Playwright visual specs. Unit tests live next to source as `*.test.ts(x)`.

## Auth model

- Server-side: `requireOwnerCtx` in `api/_gqlContext.ts` is the real gate for owner-only writes and paid calls (e.g. Gemini); trip-scoped actions are gated by `requireMemberCtx` / `requireCreatorCtx` in the same file, and `requireUserCtx` admits any signed-in account where something else authorizes the action (`claimInvite`, whose invite token is the authorization).
- Client-side: `useOwner()` in `src/lib/useOwner.ts` is a UI hint only. Owner emails come from `VITE_OWNER_EMAILS`.
- Public by decision: `drivingMiles` (#66) calls OpenRouteService with no auth gate, because the owner chose road miles for every visitor. It's a free service rather than a paid one, and a Turso-counted hourly budget (`ors_usage`) caps it: 20 uncached lookups an hour, of which signed-out callers may use 12, for West Coast origins only. Over budget it returns nothing and the client shows the "≈" straight-line estimate. Any other public external call needs its own recorded decision here.
- Owner photos (#19) live in a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`, from the store connected to the project). The bytes never pass through the function: `photoUpload` hands the browser a client token that can write one JPEG pathname for ten minutes, and `activityPhotos` returns signed links that expire within the hour. Every photo call is owner-only, and an activity holds at most 20, which keeps the store inside the Hobby limits (exceeding them pauses Blob for 30 days).
- Role-gated UI: owner-guarded *mutating* controls are **hidden** from non-owners (not disabled/greyed). See the Role-gated UI section below.

## Role-gated UI — hide owner-guarded controls from non-owners

**Convention (current):** owner-guarded *mutating* affordances (add / edit /
delete / and other write actions) are **not rendered at all for non-owners.**
Do not render them disabled with a "Sign in to edit"-style tooltip.

> History: an earlier convention rendered these controls **disabled + tooltip**
> (greyed out). That was intentionally reversed in issue #67 — hide, don't grey
> out. If you find a greyed-out owner control, treat it as a bug to fix, not a
> pattern to copy.

Rules of thumb:

- **Mutating + owner-gated → hide.** Gate the JSX on `isOwner` (e.g.
  `{isOwner && <button …/>}`). No `disabled={!isOwner}`, no
  `title="Sign in to edit"`.
- **Reads stay.** If a surface is a *read* (viewing data — e.g. a
  completion-status badge, or the owners' reviews), keep it visible to
  everyone; only the *write* affordance inside it is hidden. The completion
  **status** in `ActivityDetail` is rendered as a static badge for non-owners;
  only the interactive toggle is owner-only.
- **Owner-only reads are an explicit decision, recorded here.** The first is
  the **Explore** surface (#111): its one action, Discover, is a paid
  owner-only call, so non-owners would only reach a dead end. Decision: hide
  the tab *and* guard the route — the `/explore` NavLink in `Layout.tsx` is
  gated on `isOwner`, and `OwnerRoute` (`src/components/OwnerRoute.tsx`)
  renders nothing until auth loads, then redirects non-owners to `/`. The
  second is the **Your Photos** gallery (#19): the photos are the owners' own,
  so `ActivityDetail` renders the whole section only for owners, and the
  server's `activityPhotos` read is owner-gated too.

Gates that are **not** the owner gate:

- **Sign-in-gated CTAs** ("is signed in", i.e. `useOwner().email`), e.g.
  "Select for trip" and "Add to trip" in `CuratedAdventures`, follow the same hide
  rule (#112): **not rendered for signed-out visitors** — no disabled state,
  no "Sign in to…" tooltip. Signed-in users (owners *and* invited editors) see
  them, since adding to a trip is a member power (#51). The per-card "Add to
  trip" renders only while building a trip (selection mode, which an incoming
  trip target also opens), keeping the default browse view uncluttered.
- **Trip-creator-gated** controls in `TripDetail` (reopen voting, mark past,
  delete trip, finalize voting, remove member) — gated on being *this trip's*
  creator, a per-trip role shown to trip members, not the global owner gate.
  They keep their existing presentation for the members who see them.

**Server is the real gate.** `useOwner()` is a UI hint only. `requireOwnerCtx`
in `api/_gqlContext.ts` (and `requireMemberCtx` / `requireCreatorCtx` for
trip-scoped actions, `requireUserCtx` for any signed-in account) is the actual
enforcement and is unchanged by any of the
above — hiding a control never replaces server-side authorization.

- Visual regression: owner-gated UI is exercised in Playwright via the
  dev/test-only `window.__TEST_FORCE_OWNER__` flag (see `src/lib/useOwner.ts`),
  and signed-in views (the trips pages, #59) via `window.__TEST_FORCE_EMAIL__`
  (see `src/lib/authShim.ts`; the `signIn` helper in `tests/visual/helpers.ts`
  sets both).
  Default (non-owner) snapshots must therefore show owner controls *absent*.
  Run `npm run test:visual:update` after changing owner-gated presentation.

## GitHub issues are the source of truth for product context

**Always check `gh issue list` (and `gh issue view <n>`) before designing or implementing a feature.** Issues in this repo carry the full rationale — scope decisions, cross-feature coordination, acceptance criteria, deferred questions — and frequently reference each other (e.g. "coordinates with #16", "supersedes #7"). The codebase alone will not tell you why something was built the way it was.

When picking up a task:
1. `gh issue list --state all` to see what's in flight / closed.
2. `gh issue view <n>` for any issue the user mentions or that matches the task.
3. Skim issues that the relevant issue cross-references.

When filing a new feature request, follow the existing issue style (Problem / What to add / Scope / Coordinates with / Acceptance criteria) and link related issues explicitly.

## Conventions

- Vercel function handlers: Node-style `(req, res)` — Web API style hangs in `vercel dev`.
- **Tests ship with the code.** Any new resolver, reducer, or pure util needs its own unit test; run `npm run test:coverage` before pushing (CI enforces an 80% per-file gate — plain `vitest run` skips it). The coverage backlog in `vite.config.ts` (pre-gate files excluded from it) may only shrink: `src/test/coverageBacklog.test.ts` pins it to an explicit list and fails when a file is added (write tests instead), when one leaves the backlog without leaving the pinned list too (delete it there, so the pin ratchets down), or when an entry names a file that no longer exists. Tests are pure logic or RTL — no real network, DB, or browser. Multi-write DB paths get a test asserting a single `db().batch(stmts, 'write')` (see `transitionToPast`/`createTrip`/`patchTrip`).
- **Mutation testing checks the assertions.** `mutation.yml` mutates the files a PR changes (the `mutate` globs in `stryker.config.json`, read by `.github/scripts/mutation-scope.mjs`; a changed test counts as a change to the file it covers) and fails below the `break` score; a weekly sweep covers everything. A surviving mutant means a missing assertion: add the test, or delete the code if it can never matter. The globs mirror the coverage scope in `vite.config.ts`, backlog included, and `src/test/mutationScope.test.ts` fails if the two drift apart. `patches/` holds a `patch-package` fix that makes Stryker's vitest runner name tests the way Vitest 5 matches them (stryker-js#6210); the runner is pinned to 10.0.0 so a release can't break it. Delete the patch and unpin once a Stryker release carries the fix.
- **No `legacy-peer-deps`.** Installs are plain `npm ci`. Resolve a peer conflict with a version bump, or with a narrow `overrides` entry explained in the commit and here. The two today, `eslint-plugin-import` and `eslint-plugin-jsx-a11y` → `eslint: $eslint`, exist because neither has a release whose peer range includes ESLint 10. Delete each once it does (or move `import` to `eslint-plugin-import-x`, which already supports 10).
- **Commit hygiene.** Imperative subject ≤72 chars; body explains *why*; end
  with the `Co-Authored-By:` trailer. One logical change per commit; squash
  noisy commits (fixups, reverts, "address review") into a clean history before
  opening or updating a PR. Linear history (rebase, not merge). Amend or squash
  your own feature branch freely before it merges, but never amend, rebase, or
  force-push `main`. CI's commit-message step (`.github/scripts/check-commits.sh`)
  fails a PR on a subject over 72 chars, a missing body, a fixup/"oops" commit
  or a merge commit.
- **Never** `git add -A`/`git add .` (stage files explicitly), modify a test to
  make it pass (fix the implementation instead), install packages outside the
  project root, or use `--no-verify`.
- **Show UI changes in the PR.** A PR that changes a component or stylesheet
  puts before/after visuals in its description (`.github/pull_request_template.md`):
  screenshots for how things look, GIFs for how things move or respond (drag,
  animation, open/close, scroll, multi-step flows). Host the images on a
  `pr-screenshots/<topic>` branch whose tree has a `vercel.json` with
  `{"git":{"deploymentEnabled":false}}`, so they cost no deploy. The
  `PR visuals` check (`.github/scripts/pr-visuals.mjs`) fails a UI change with
  no picture unless "No visible UI change" is ticked; Claude Review asks for a
  GIF when motion changes.
- **Review before raising a PR.** Review the full diff (e.g. a review subagent
  reading it) before opening the PR — review gates PR creation, rather than
  opening first and reviewing after.
- Rules already enforced by tooling — committing secrets (gitleaks), pushing to
  `main` (branch protection), and inline lint/type suppression (the `no-use`
  and `ban-ts-comment` lint rules) — are the source of truth and aren't
  repeated here.
