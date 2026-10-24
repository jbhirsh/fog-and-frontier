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
- `npm run db:snapshot` / `db:seed-preview` — Turso helpers in `scripts/`. The catalog lives only in Turso; there is no static seed.
- `npm run gif -- <scenario.ts> --dir <PR>` — before/after GIFs of a UI change for its PR (`scripts/pr-gif-cli.ts`; below, "Show UI changes in the PR").
- `npm run links:check` — audit every outbound link in the live catalog (#68): dead links fail it, bot-blocked ones (AllTrails) are listed for checking by hand. Runs weekly in `links.yml`.
- `npm run instagram:check` — read a few known public Instagram posts the way sharing does (#6), failing when Instagram's pages no longer give what the reader needs. Runs weekly in `instagram.yml`.

## Layout

- `src/` — React app. `src/pages/`, `src/components/`, `src/lib/`, `src/data/types.ts` (Activity model).
- `api/` — the GraphQL function. `graphql.ts` is the handler; `_schema.ts` is the SDL; `_resolvers/*` implement it. `_gqlContext.ts` has the server auth gates (`requireOwnerCtx`, `requireMemberCtx` / `requireCreatorCtx` for trips, and `requireUserCtx` for any signed-in account), built on the Clerk token check in `_auth.ts`; `_db.ts` is the Turso client.
- `public/` — static assets.
- Cover photos load through Vercel's image CDN on deployments (`src/lib/imageCdn.ts`, `CdnImage`): resized per card, cached a month, so visitors don't each go to Wikimedia, which hosts most of them and throttles a busy machine. Only the hosts in `vercel.json`'s `images.remotePatterns` (kept equal to `CDN_HOSTS` by a test) go through it; a photo on any other host loads from its own URL, so add a new host to both.
- `scripts/` — DB / migration helpers (Node, `--experimental-strip-types` for `.mts/.ts`).
- `tests/` — Playwright visual specs. Unit tests live next to source as `*.test.ts(x)`.

## Auth model

- Server-side: `requireOwnerCtx` in `api/_gqlContext.ts` is the real gate for owner-only writes and paid calls (e.g. Gemini, apart from the capped drafts below); trip-scoped actions are gated by `requireMemberCtx` / `requireCreatorCtx` in the same file, and `requireUserCtx` admits any signed-in account: where something else authorizes the action (`claimInvite`, whose invite token is the authorization), and for suggestions and their capped drafts (#73, below).
- Client-side: `useOwner()` in `src/lib/useOwner.ts` is a UI hint only. Owner emails come from `VITE_OWNER_EMAILS`.
- Public by decision: `drivingMiles` (#66) calls OpenRouteService with no auth gate, because the owner chose road miles for every visitor. It's a free service rather than a paid one, and a Turso-counted hourly budget (`ors_usage`) caps it: 20 uncached lookups an hour, of which signed-out callers may use 12, for West Coast origins only. Over budget it returns nothing and the client shows the "≈" straight-line estimate. Any other public external call needs its own recorded decision here.
- Owner photos (#19) live in a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`, from the store connected to the project). The bytes never pass through the function: `photoUpload` hands the browser a client token that can write one JPEG pathname for ten minutes, and `activityPhotos` returns signed links that expire within the hour. Every photo call is owner-only, and an activity holds at most 20, which keeps the store inside the Hobby limits (exceeding them pauses Blob for 30 days).
- Contributors (#9): who added each activity (`contributors`, account emails) goes to any signed-in account and to no one else. The `Activity` / `ActivitySnapshot` field resolver in `api/_resolvers/catalog.ts` returns null to a signed-out caller, so the public catalog never says who added what; the UI simply has nothing to show them. `saveActivity` credits the caller on a new activity, keeps the stored list when the input omits it, and only credits emails with a `users` row. An activity saved before #9 stays uncredited until the backfill credits it.
- Suggestions and capped AI drafts (#73), by decision: any signed-in account may suggest an activity (`suggestActivity`, `requireUserCtx`), with at most 10 of its own waiting at once. It waits in the `suggestions` table, which the public catalog read never touches, until an owner accepts it into the catalog (credited to its suggester, who then gets a `users` row) or rejects it; `pendingSuggestions`, `acceptSuggestion` and `rejectSuggestion` are owner-only. A suggestion keeps only http(s) links (`keepSavableLinks` in `api/_links.ts`), since these are the first links written by non-owners. To draft one, a signed-in non-owner may use `generateActivity`, the paid Gemini call, capped by a Turso-counted daily budget (`gemini_assists`, `api/_assistBudget.ts`): 5 drafts per account and 30 in all per UTC day, and each draft's title, notes and links are bounded (200 and 2000 characters, five links), since every link is read and billed. Over the cap, the call is refused with `assist_limit` before Gemini is reached. A draft whose request to Gemini fails (no answer, or a non-2xx) is given back (`releaseAssist`); one Gemini answered stays counted, however unusable, since it was billed. Owners aren't counted. Every other Gemini call stays owner-only. A draft isn't required: the suggest dialog can be filled in by hand, offered from the start and in Generate's place once today's drafts are used up (#260), and the client holds back any suggestion without a name, a short description, a category, a region, a duration, a city and a pin (a hand-filled one guesses none of them), since the owners can't edit one before accepting it.
- Sharing from Instagram (#6), owner-only: `findSharedPlaces` (`requireOwnerCtx`) reads a shared Instagram post and has Gemini name its places, which an owner then adds one at a time through the usual dialog, `/share`. Phones reach it from the share sheet: Android through the manifest's `share_target`, iPhone through a Shortcut that opens `/share?url=…` (Safari has no share target). The reader, `api/_instagram.ts`, makes these outside calls, each on its own time limit, and never throws. First, two pages read side by side. Instagram's public embed page gives the caption, author and picture. The post page gives the video files and the geotag, and answers only a plain `curl` user agent carrying the cookies from Instagram's home page. Either alone is enough for a share, so if Instagram stops serving one, sharing still works from the other and the weekly canary fails. Then the smallest video (up to 60 MB), or else the picture (4 MB), only from Instagram's own media hosts and within 20 seconds. A video up to 14 MB goes to Gemini inline, within a request's 20 MB; a bigger one (some reels come only at a high bitrate) is uploaded through Gemini's Files API (`api/_geminiFiles.ts`), within 45 seconds, and deleted once Gemini has answered. Gemini is given whatever answered, with Google Search but not URL reading (the caption is a stranger's text), and isn't called when nothing answered and there's no hint. The page keeps each post's places for the session, so a reload doesn't pay for the same read again. A geotag is only a hint: they're often wrong. An activity added from a post keeps the post's link as its `sourceUrl`, which the detail shows to everyone ("Seen on Instagram"); the weekly link audit reads it through the embed page, which says when a post has been taken down or made private, and fails on one. Each share logs one `share.places` line saying which sources answered, and `instagram.yml` reads known posts weekly, so a change on Instagram's side shows up there.
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
  server's `activityPhotos` read is owner-gated too. The third is the
  **review queue** (#73): pending suggestions, with Accept / Reject, above
  the catalog list (`PendingSuggestions`). Only owners can decide them, so
  `CuratedAdventures` asks for `pendingSuggestions` only for owners, and
  shows the section only while something is waiting. Its count is a Review
  button in the toolbar (and the mobile map's sheet), so it shows in every
  view (#259). The fourth is **sharing from Instagram** (#6): reading a post is a
  paid Gemini call, so `/share` sends a signed-in non-owner home. A
  signed-out visitor is asked to sign in instead, since an owner opening a
  share in Safari (from the iPhone Shortcut) may not be signed in there yet.

Gates that are **not** the owner gate:

- **Sign-in-gated CTAs** ("is signed in", i.e. `useOwner().email`), e.g.
  "Select for trip" and "Add to trip" in `CuratedAdventures`, follow the same hide
  rule (#112): **not rendered for signed-out visitors** — no disabled state,
  no "Sign in to…" tooltip. Signed-in users (owners *and* invited editors) see
  them, since adding to a trip is a member power (#51). The per-card "Add to
  trip" renders only while building a trip (selection mode, which an incoming
  trip target also opens), keeping the default browse view uncluttered.
- **Suggest activity** (#73) is a sign-in-gated CTA for non-owners: signed-in
  non-owners see it where owners see "Add activity", and signed-out visitors
  see neither.
- The **Contributors filter** (#9) is a read, but signed-out visitors get no
  contributor data to filter on, so it isn't rendered for them, and a shared
  `?contributors=` link is ignored rather than emptying their list.
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
- **Mutation testing checks the assertions.** `mutation.yml` mutates the files a PR changes (the `mutate` globs in `stryker.config.json`, read by `.github/scripts/mutation-scope.mjs`; a changed test counts as a change to the file it covers) and fails below the `break` score; a weekly sweep covers everything. PR runs are incremental: each caches its results for the PR, so a later push re-runs only the mutants whose code or tests changed. A change to the lockfile, `patches/`, the Stryker or Vite config, or `src/test/` starts the PR over; a change that reaches a mutant only through an import isn't detected, which the weekly sweep backstops. A surviving mutant means a missing assertion: add the test, or delete the code if it can never matter. The globs mirror the coverage scope in `vite.config.ts`, backlog included, and `src/test/mutationScope.test.ts` fails if the two drift apart. `patches/` holds a `patch-package` fix that makes Stryker's vitest runner name tests the way Vitest 5 matches them (stryker-js#6210); the runner is pinned to 10.0.0 so a release can't break it. Delete the patch and unpin once a Stryker release carries the fix.
- **No `legacy-peer-deps`.** Installs are plain `npm ci`. Resolve a peer conflict (or a security advisory with no upstream fix) with a version bump, or with a narrow `overrides` entry explained in the commit and here. Two of today's, `eslint-plugin-import` and `eslint-plugin-jsx-a11y` → `eslint: $eslint`, exist because neither has a release whose peer range includes ESLint 10. Delete each once it does (or move `import` to `eslint-plugin-import-x`, which already supports 10). The third, `@vercel/cli-config` → `zod: ^4.6.6`, lifts zod past GHSA-mrhx-c7xc-m3w5 (it fails CI's `npm audit`), since every release of `@vercel/cli-config`, which `@vercel/blob` pulls in, pins zod 4.1.11. Delete it once a release pins a fixed zod.
- **Commit hygiene.** Imperative subject ≤72 chars; body explains *why*; end
  with the `Co-Authored-By:` trailer. One logical change per commit; squash
  noisy commits (fixups, reverts, "address review") into a clean history before
  opening or updating a PR. Linear history (rebase, not merge). Amend or squash
  your own feature branch freely before it merges, but never amend, rebase, or
  force-push `main`. CI's commit-message step (`.github/scripts/check-commits.sh`)
  fails a PR on a subject over 72 chars, a missing body, a fixup/"oops" commit
  or a merge commit.
- **Few branches.** Work on one branch, with one PR open at a time. Related
  changes go in as separate commits on that PR (a rebase-merge keeps them
  separate on `main`), not as a stack of PRs. Once it merges, restart the same
  branch from `main` for the next change. Don't push helper branches: the
  visual workflow commits regenerated baselines onto the PR's own branch, and
  screenshots share one branch (below).
- **Never** `git add -A`/`git add .` (stage files explicitly), modify a test to
  make it pass (fix the implementation instead), install packages outside the
  project root, or use `--no-verify`.
- **Show UI changes in the PR.** A PR that changes a component or stylesheet
  puts before/after visuals in its description (`.github/pull_request_template.md`):
  screenshots for how things look, GIFs for how things move or respond (drag,
  animation, open/close, scroll, multi-step flows). Host the images on the one
  `screenshots` branch, in a folder named for the PR (`<number>/`), and link
  them by commit SHA so a later push can't change what a PR shows. Its tree has
  a `vercel.json` with `{"git":{"deploymentEnabled":false}}`, so it costs no
  deploy. (Older PRs' pictures, once on `pr-screenshots/<topic>` branches, now
  live there under `<topic>/`.) The
  `PR visuals` check (`.github/scripts/pr-visuals.mjs`) fails a UI change with
  no picture unless "No visible UI change" is ticked; Claude Review asks for a
  GIF when motion changes.
  Pictures show the app exactly as production does: the real catalog, photos,
  fonts and map, never the visual tests' stub (its fixtures have blank covers
  and it blanks every outside image). So take them from local production
  builds of `main` ("before") and the branch ("after"), never the dev server,
  with their reads sent to production's API and their photos through
  production's image CDN; owner-only screens the same way, signed in through
  the test flags. Record GIFs with `npm run gif -- <scenario.ts> --dir <PR
  number>` (`scripts/pr-gif-cli.ts`): it builds both, records the scenario
  (`scripts/gif-scenarios/`) against each with the pointer and keys drawn in,
  at the speed the page moved, commits the GIFs to `screenshots` and prints
  the Before/After table. `scripts/pr-gif.ts`'s header has the
  rules for writing a scenario: its `glide`, `click`, `drag` and `scroll`,
  which go by the clock, with pauses, never `locator.click()` or a bare
  `page.mouse`; the pointer kept in frame; ending on a pause. Check a few
  frames, and the long ones, before publishing.
- **Review before raising a PR.** Review the full diff (e.g. a review subagent
  reading it) before opening the PR — review gates PR creation, rather than
  opening first and reviewing after.
- Rules already enforced by tooling — committing secrets (gitleaks), pushing to
  `main` (branch protection), and inline lint/type suppression (the `no-use`
  and `ban-ts-comment` lint rules) — are the source of truth and aren't
  repeated here.
