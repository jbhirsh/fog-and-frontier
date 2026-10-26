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
- `npm run typecov` — type-coverage over `tsconfig.app.json` and `tsconfig.api.json`: fails on any identifier typed `any`, and names it.
- `npm run format` / `format:check` — Prettier over the whole repo (`.prettierrc.json`: single quotes, 100 columns; `.prettierignore` leaves out the lockfile, `src/gql/`, `patches/` and `public/`).
- `npm test` / `test:watch` / `test:coverage` — Vitest.
- `npm run test:mutation` — StrykerJS over the files the coverage gate measures (`stryker.config.json`).
- `npm run test:visual` — Playwright visual regression: the desktop pages in Chromium, Firefox and WebKit (`desktop`, `desktop-firefox`, `desktop-webkit`) and the mobile ones on an iPhone (WebKit), each against its own Linux baselines. Baselines come from CI, not a laptop (fonts differ): run `visual.yml` by hand with `update_snapshots` on the branch, which commits them there.
- `npm run db:snapshot` / `db:seed-preview` — Turso helpers in `scripts/`. The catalog lives only in Turso; there is no static seed.
- `npm run cards -- draft` / `cards -- save` — card copy (#295) for places saved without it: Gemini drafts a review file, an owner edits it, then saves it to production.
- `npm run gif -- <scenario.ts> --dir <PR>` — before/after GIFs of a UI change for its PR (`scripts/gif.mjs`, which runs jbhirsh/ci's `gif` tool; below, "Show UI changes in the PR").
- `npm run regions:gen` — regenerate `shared/isoRegions.ts` from ISO 3166 (Debian's `iso-codes` package, `apt install iso-codes`), when a new release adds or renames regions.
- `npm run links:check` — audit every outbound link in the live catalog (#68): dead links fail it, bot-blocked ones (AllTrails) are listed for checking by hand. Runs weekly in `links.yml`.
- `npm run instagram:check` — read a few known public Instagram posts the way sharing does (#6), failing when Instagram's pages no longer give what the reader needs. Runs weekly in `instagram.yml`.

## Layout

- `src/` — React app. `src/pages/`, `src/components/`, `src/lib/`, `src/data/types.ts` (Activity model).
- `api/` — the GraphQL function. `graphql.ts` is the handler; `_schema.ts` is the SDL; `_resolvers/*` implement it. `_gqlContext.ts` has the server auth gates (`requireOwnerCtx`, `requireMemberCtx` / `requireCreatorCtx` for trips, and `requireUserCtx` for any signed-in account), built on the Clerk token check in `_auth.ts`; `_db.ts` is the Turso client.
- `shared/` — data the app and the API both read, since neither may import the other. Today that's regions (#274). An activity's region is one of California's areas (`sf` … `socal`) or the ISO 3166 code of anywhere else: a country's first-level subdivision (`US-OR`, `JP-26`, `CA-BC`), or a country with none (`HK`). `shared/regions.ts` holds the California areas and the `Region` type, and `shared/isoRegions.ts` the generated ISO list. Each side keeps its own logic: `api/_regions.ts` validates on save, on read (where `oregon` and `washington`, saved before #274, become `US-OR` and `US-WA`) and on a draft; `src/lib/regions.ts` and `RegionPicker` give the form's search. The app loads the ISO list as its own chunk, only when the form needs it.
- `public/` — static assets.
- Cover photos load through Vercel's image CDN on deployments (`src/lib/imageCdn.ts`, `CdnImage`): resized per card, cached a month, so visitors don't each go to Wikimedia, which hosts most of them and throttles a busy machine. Only the hosts in `vercel.json`'s `images.remotePatterns` (kept equal to `CDN_HOSTS` by a test) go through it; a photo on any other host loads from its own URL, so add a new host to both.
- `scripts/` — DB / migration helpers (Node, `--experimental-strip-types` for `.mts/.ts`).
- `tests/` — Playwright visual specs. Unit tests live next to source as `*.test.ts(x)`.

## Auth model

- Server-side: `requireOwnerCtx` in `api/_gqlContext.ts` is the real gate for owner-only writes and paid calls (e.g. Gemini, apart from the capped drafts below); trip-scoped actions are gated by `requireMemberCtx` / `requireCreatorCtx` in the same file, and `requireUserCtx` admits any signed-in account: where something else authorizes the action (`claimInvite`, whose invite token is the authorization), and for suggestions and their capped drafts (#73, below).
- Client-side: `useOwner()` in `src/lib/useOwner.ts` is a UI hint only. Owner emails come from `VITE_OWNER_EMAILS`.
- Public by decision: `drivingMiles` (#66) calls OpenRouteService with no auth gate, because the owner chose road miles for every visitor. It's a free service rather than a paid one, and a Turso-counted hourly budget (`ors_usage`) caps it: 20 uncached lookups an hour, of which signed-out callers may use 12, for West Coast origins only. Over budget it returns nothing and the client shows the "≈" straight-line estimate. Any other public external call needs its own recorded decision here.
- Owner photos (#19) live in a private Vercel Blob store (`BLOB_READ_WRITE_TOKEN`, from the store connected to the project). The bytes never pass through the function: `photoUpload` hands the browser a client token that can write one JPEG pathname for ten minutes, and `activityPhotos` returns signed links that expire within the hour. Every photo call is owner-only, and an activity holds at most 20, which keeps the store inside the Hobby limits (exceeding them pauses Blob for 30 days).
- Contributors (#9): who added each activity (`contributors`, account emails) goes to any signed-in account and to no one else. The `Activity` / `ActivitySnapshot` field resolver in `api/_resolvers/catalog.ts` returns null to a signed-out caller, so the public catalog never says who added what; the UI simply has nothing to show them. `saveActivity` credits the caller on a new activity, keeps the stored list when the input omits it, and only credits emails with a `users` row. An activity saved before #9 stays uncredited until the backfill credits it. People are shown by their first name (`users.display_name`, which each account's own sign-in fills from Clerk: an owner's on every request, an editor's existing row once it lands on a warm instance (never a new row, and never failing the request) and when they claim an invite), through `PeopleProvider`'s users list for a signed-in reader; reviews carry their author's name (`authorName`) for everyone, since reviews are public. Anyone with no name yet, or sharing a first name with another account, is named from their email.
- Suggestions and capped AI drafts (#73), by decision: any signed-in account may suggest an activity (`suggestActivity`, `requireUserCtx`), with at most 10 of its own waiting at once. It waits in the `suggestions` table, which the public catalog read never touches, until an owner accepts it into the catalog (credited to its suggester, who then gets a `users` row) or rejects it; `pendingSuggestions`, `acceptSuggestion` and `rejectSuggestion` are owner-only. A suggestion keeps only http(s) links (`keepSavableLinks` in `api/_links.ts`), since these are the first links written by non-owners. Nor does it keep a park (`parentId`, #269): an owner sets that once it's accepted, since only an owner chooses what a park holds. To draft one, a signed-in non-owner may use `generateActivity`, the paid Gemini call, capped by a Turso-counted daily budget (`gemini_assists`, `api/_assistBudget.ts`): 5 drafts per account and 30 in all per UTC day, and each draft's title, notes and links are bounded (200 and 2000 characters, five links), since every link is read and billed. Over the cap, the call is refused with `assist_limit` before Gemini is reached. A hike's draft gets its AllTrails page searched for on AllTrails itself (`api/_allTrailsSearch.ts`, #6), since AllTrails often lists a place under another name: Gemini, with no Google Search, is given the draft's facts and a `search_alltrails` tool, which the server runs on an Agent Search app (Google Cloud's Discovery Engine `searchLite`, project `gen-lang-client-0818068083`) that indexes `www.alltrails.com/trail/*` and nothing else, with its own key (`AGENT_SEARCH_API_KEY`, restricted to that API). It searches by as many names as it needs, at most 6 searches in 3 rounds, then picks a trail with `choose_trail`, naming up to three others it might have meant, and the pick is kept only if one of its searches returned that page (so are the others). The form draws the trail in use as a card (`TrailPicker`): its picture, rating and count, distance and climb, and description, as far as its page gave them to the search (`trailStats`; pictures load straight from AllTrails' or Google's thumbnail host), and a link to it on AllTrails. "Not the right trail?" turns the card into a list of every trail found, to check on AllTrails and select another. A draft's own link (from its Google Search) is passed to it as a lead, and is replaced by what the search finds, nothing included; it stays only when the search fails, or, without the key, doesn't run. It's part of the same draft, so it isn't counted again, and one that fails isn't given back either: the draft was billed, and simply keeps what it had. A draft whose request to Gemini fails (no answer, a non-2xx, or none begun within its 90 seconds, which the caller is told to retry) is given back (`releaseAssist`); one Gemini answered stays counted, however unusable, since it was billed. Owners aren't counted. Every other Gemini call stays owner-only. A draft isn't required: the suggest dialog can be filled in by hand, offered from the start and in Generate's place once today's drafts are used up (#260), and the client holds back any suggestion without a name, a short description, a category, a region, a duration, a city and a pin (a hand-filled one guesses none of them), since the owners can't edit one before accepting it.
- Sharing from Instagram (#6), owner-only: `findSharedPlaces` (`requireOwnerCtx`) reads a shared Instagram post and has Gemini name its places, which an owner then adds one at a time through the usual dialog, `/share`. Phones reach it from the share sheet: Android through the manifest's `share_target`, iPhone through a Shortcut that opens `/share?url=…` (Safari has no share target). The reader, `api/_instagram.ts`, makes these outside calls, each on its own time limit, and never throws. First, two pages read side by side. Instagram's public embed page gives the caption, author and picture. The post page gives the video files and the geotag, and answers only a plain `curl` user agent carrying the cookies from Instagram's home page. Either alone is enough for a share, so if Instagram stops serving one, sharing still works from the other and the weekly canary fails. Then the smallest video (up to 60 MB), or else the picture (4 MB), only from Instagram's own media hosts and within 20 seconds. A video up to 14 MB goes to Gemini inline, within a request's 20 MB; a bigger one (some reels come only at a high bitrate) is uploaded through Gemini's Files API (`api/_geminiFiles.ts`), within 45 seconds, and deleted once Gemini has answered. Gemini is given whatever answered, with Google Search but not URL reading (the caption is a stranger's text), and isn't called when nothing answered and there's no hint. The page keeps each post's places for the session, so a reload doesn't pay for the same read again. A geotag is only a hint: they're often wrong. An activity added from a post keeps the post's link as its `sourceUrl`, which the detail shows to everyone ("Seen on Instagram"); the weekly link audit reads it through the embed page, which says when a post has been taken down or made private, and fails on one. Each share logs one `share.places` line saying which sources answered, and `instagram.yml` reads known posts weekly, so a change on Instagram's side shows up there.
- Role-gated UI: owner-guarded _mutating_ controls are **hidden** from non-owners (not disabled/greyed). See the Role-gated UI section below.

## Role-gated UI — hide owner-guarded controls from non-owners

**Convention (current):** owner-guarded _mutating_ affordances (add / edit /
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
- **Reads stay.** If a surface is a _read_ (viewing data — e.g. a
  completion-status badge, or the owners' reviews), keep it visible to
  everyone; only the _write_ affordance inside it is hidden. The completion
  **status** in `ActivityDetail` is rendered as a static badge for non-owners;
  only the interactive toggle is owner-only.
- **Owner-only reads are an explicit decision, recorded here.** The first is
  the **Explore** surface (#111): its one action, Discover, is a paid
  owner-only call, so non-owners would only reach a dead end. Decision: hide
  the tab _and_ guard the route — the `/explore` NavLink in `Layout.tsx` is
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
  no "Sign in to…" tooltip. Signed-in users (owners _and_ invited editors) see
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
  delete trip, finalize voting, remove member) — gated on being _this trip's_
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
  Default (non-owner) snapshots must therefore show owner controls _absent_.
  Run `npm run test:visual:update` after changing owner-gated presentation.

## GitHub issues are the source of truth for product context

**Always check `gh issue list` (and `gh issue view <n>`) before designing or implementing a feature.** Issues in this repo carry the full rationale — scope decisions, cross-feature coordination, acceptance criteria, deferred questions — and frequently reference each other (e.g. "coordinates with #16", "supersedes #7"). The codebase alone will not tell you why something was built the way it was.

When picking up a task:

1. `gh issue list --state all` to see what's in flight / closed.
2. `gh issue view <n>` for any issue the user mentions or that matches the task.
3. Skim issues that the relevant issue cross-references.

When filing a new feature request, follow the existing issue style (Problem / What to add / Scope / Coordinates with / Acceptance criteria) and link related issues explicitly.

## Conventions

- **CI tooling is shared** with sift and BoardGames in
  [jbhirsh/ci](https://github.com/jbhirsh/ci), run from its `main` (no
  version pin): mutation testing, Claude Review and autofix, PR GIFs, PR
  visuals, the commit check, the weekly audit, the README screenshot bot,
  Dependabot auto-merge and the secret and SAST scans. The workflows here
  keep their triggers and job names (the required checks) and call it; this
  repo's settings for each tool are its key in `.github/ci.json`, and how a
  tool works is in its headers there. Change a tool in jbhirsh/ci (cloned
  beside this repo as `../ci`), never by copying it back here. A new
  pull-request workflow goes in `claude-autofix.yml`'s trigger list, or in
  `.github/ci.json`'s `autofix.exempt` with its reason; CI's autofix
  trigger check fails a PR that does neither.
- Vercel function handlers: Node-style `(req, res)` — Web API style hangs in `vercel dev`.
- **Tests ship with the code.** Any new resolver, reducer, or pure util needs its own unit test; run `npm run test:coverage` before pushing (CI enforces an 80% per-file gate — plain `vitest run` skips it). The coverage backlog in `vite.config.ts` (pre-gate files excluded from it) may only shrink: `src/test/coverageBacklog.test.ts` pins it to an explicit list and fails when a file is added (write tests instead), when one leaves the backlog without leaving the pinned list too (delete it there, so the pin ratchets down), or when an entry names a file that no longer exists. Tests are pure logic or RTL — no real network, DB, or browser. Multi-write DB paths get a test asserting a single `db().batch(stmts, 'write')` (see `transitionToPast`/`createTrip`/`patchTrip`).
- **Property tests fuzz the pure helpers** (`fast-check`, in
  `*.property.test.ts` beside the example tests): input a person, a shared
  link or the browser hands over (history state, `?contributors=`, a
  suggestion's links, pointer positions) is generated by the hundred, and
  each test states what must hold for all of it (never throws, reads back
  what it wrote, stays in range). A failure prints its seed and the smallest
  counterexample; fix the code, or the property if it claimed too much.
- **Mutation testing checks the assertions.** A PR's run mutates only the lines it changed in the files the `mutate` globs in `stryker.config.json` cover, and fails below the `break` score; a monthly sweep (8 parallel shards) covers everything. `mutation.yml` calls jbhirsh/ci's `mutation` tool, whose module headers say what counts as a change, when Stryker is skipped and how results are cached; this repo's settings for it are the `mutation` key of `.github/ci.json`. A surviving mutant means a missing assertion: add the test, or delete the code if it can never matter. The globs mirror the coverage scope in `vite.config.ts`, backlog included, and `src/test/mutationScope.test.ts` fails if the two drift apart. `patches/` holds a `patch-package` fix that makes Stryker's vitest runner name tests the way Vitest 5 matches them (stryker-js#6210); the runner is pinned to 10.0.0 so a release can't break it. Delete the patch and unpin once a Stryker release carries the fix.
- **Prettier formats everything** (code, CSS, Markdown, YAML, JSON); ESLint
  checks correctness only, and `eslint-config-prettier`, last in the flat
  config, turns off any rule that would argue with it. CI's "Format
  (Prettier)" step fails an unformatted file and the pre-commit hook checks
  the staged ones: run `npm run format`, never hand-align around it.
  `.git-blame-ignore-revs` lists the one-time reformat (#267) by its SHA on
  `main`, so GitHub's blame skips it; for local blame, set
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` once.
- **No `any` anywhere.** CI's "Type coverage" step (`npm run typecov`)
  holds `src/` and `api/` at 100%: an identifier whose type is `any`
  fails it, wherever it came from (a `JSON.parse`, a mock's calls, an
  `Array.isArray` on `unknown`, a library's loose type). Give it a real type
  (annotate the parameter `unknown` and narrow, declare the `VITE_`
  variable in `src/vite-env.d.ts`, type the router state
  `Location<unknown>`); there are no ignore comments, and only the generated
  `src/gql/` is skipped. The strict figure, which also counts casts, is in
  the job summary for information.
- **JSDoc that's written must be right; none is required.**
  `eslint-plugin-jsdoc` (its TypeScript-flavoured recommended rules, every
  `require-*` rule off) fails a `@param` naming no parameter, an unknown
  tag, a malformed block or a type in braces in TypeScript (types live in
  the code; plain `.js`/`.mjs` may use them). Change the comment with the
  code it describes.
- **Tailwind classes are linted** (`eslint-plugin-better-tailwindcss`, its
  rules listed in `eslint.config.js`): conflicting, duplicate, unknown or
  deprecated classes fail, and one class order and the canonical spelling
  (`size-4` for `w-4 h-4`, a scale step for an arbitrary value it equals)
  are enforced, but two different tokens that share a value (`px-gutter`
  and `py-md`) stay as written. `npm run lint:fix` rewrites them; a plain
  CSS class the plugin can't see goes in the rule's `ignore`.
- **No `legacy-peer-deps`.** Installs are plain `npm ci`. Resolve a peer conflict (or a security advisory with no upstream fix) with a version bump, or with a narrow `overrides` entry, its reason (and when to delete it) written beside it in `package.json`'s `//overrides`.
- **Commit hygiene.** Imperative subject ≤72 chars; body explains _why_; end
  with the `Co-Authored-By:` trailer. One logical change per commit; squash
  noisy commits (fixups, reverts, "address review") into a clean history before
  opening or updating a PR. Linear history (rebase, not merge). Amend or squash
  your own feature branch freely before it merges, but never amend, rebase, or
  force-push `main`. CI's commit-message step (jbhirsh/ci's `commits`)
  enforces the shape.
- **The weekly audit sweeps the whole repo** (`weekly-audit.yml`, Monday
  06:00 UTC with the other sweeps, or by hand): knip (`knip.json`: unused
  files, exports, types and dependencies, and used ones `package.json`
  doesn't list), jscpd (`.jscpd.json`: duplicated code, tests aside, since
  parallel test cases are meant to read alike), lychee (every Markdown
  link, local file and `#anchor`), and a dependency-cruiser graph of
  `src/` and `api/` as an artifact. Each finding keeps one issue labelled
  `weekly-audit` (jbhirsh/ci's `audit` workflow), updated each week and
  closed once clean; the run
  stays green unless a tool breaks. Run `npx knip` and `npx jscpd` before
  pushing a refactor: both are expected to report nothing, so a finding
  is fixed, not left for the issue (an unused export goes; a genuine
  duplicate becomes a shared helper).
- **Few branches.** Work on one branch, with one PR open at a time. Related
  changes go in as separate commits on that PR (a rebase-merge keeps them
  separate on `main`), not as a stack of PRs. Once it merges, restart the same
  branch from `main` for the next change. Don't push helper branches: the
  visual workflow commits regenerated baselines onto the PR's own branch, and
  screenshots share one branch (below). The one other branch is the bot's,
  `bot/readme-screenshots` (next).
- **The README's screenshots keep themselves current.** On a push to
  `main` that changed what they show (the `readme-screenshots` key of
  `.github/ci.json`), `readme-screenshots.yml` retakes `docs/screenshots/`
  with `scripts/readme-screenshots.ts`: a local production build reading
  production's catalog and photos, as `npm run gif` records (so the map
  shows OpenStreetMap's tiles, not CARTO's, whose key only Vercel has).
  jbhirsh/ci's `readme-screenshots` tool decides which differ enough to
  replace and keeps the one bot PR from `bot/readme-screenshots`; its
  headers say how. Add a screenshot to
  the README and to `SHOTS` together (a test holds them equal).
  `BOT_PR_TOKEN` is a fine-grained token with Contents and Pull requests
  write on this repo: GitHub runs no checks on a PR the Actions token
  makes, so without it the PR never merges, and the Actions token works at
  all only if Settings → Actions → General allows Actions to create pull
  requests.
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
  `PR visuals` check (jbhirsh/ci's `visuals`; what counts as UI is the
  `visuals` key of `.github/ci.json`) fails a UI change with
  no picture unless "No visible UI change" is ticked; Claude Review asks for a
  GIF when motion changes.
  Pictures show the app exactly as production does: the real catalog, photos,
  fonts and map, never the visual tests' stub (its fixtures have blank covers
  and it blanks every outside image). So take them from local production
  builds of `main` ("before") and the branch ("after"), never the dev server,
  with their reads sent to production's API and their photos through
  production's image CDN; owner-only screens the same way, signed in through
  the test flags. Record GIFs with
  `npm run gif -- <scenario.ts> --dir <PR number>`
  (`scripts/gif.mjs`, which runs jbhirsh/ci's `gif` tool with this repo's
  live-site setup, `scripts/gif-setup.ts`): it builds both, records the
  scenario (`scripts/gif-scenarios/`) against each with the pointer and keys
  drawn in, at the speed the page moved, commits the GIFs to `screenshots`
  and prints the Before/After table. A scenario's `play(page, gif)` moves
  with `gif.glide`, `click`, `drag` and `scroll`, which go by the clock, with
  pauses, never `locator.click()` or a bare `page.mouse` (the rules are in
  jbhirsh/ci's `gif/moves.mjs`); the pointer kept in frame; ending on a
  pause. Check a few frames, and the long ones, before publishing.
- **Review before raising a PR.** Review the full diff (e.g. a review subagent
  reading it) before opening the PR — review gates PR creation, rather than
  opening first and reviewing after.
- Rules already enforced by tooling — committing secrets (gitleaks), pushing to
  `main` (branch protection), and inline lint/type suppression (the `no-use`
  and `ban-ts-comment` lint rules) — are the source of truth and aren't
  repeated here.
