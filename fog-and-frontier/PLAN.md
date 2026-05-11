# Plan: Production Safety Net + Re-attempt Lint Foundation

**Status:** Active. Pick up from here in a fresh context.
**Last updated:** 2026-05-10

## Context — what just happened

PR #8 ("Foundation, baby" — Issue #1 lint foundation) was merged and broke production:
- `/api/activities` returned 404 (build shipped without API functions)
- CSS was missing/broken
- The data on prod "appeared empty" because the API was 404'ing, not because the DB was actually wiped

**Resolution:** `git push --force` reset main to `0e87f7b` (May 7), then `vercel promote https://fog-and-frontier-93ejygj4i-jbhirshs-projects.vercel.app` restored prod (deployment `dpl_RP7UJzC3Vz8cZL7ytjDWL366QCHt`, a 23-second real build from May 7). The 3-4 second deployments in the deployment list appear to be cached/no-build artifacts that ship without API routes — avoid promoting those.

**Repo state right now:** clean, on `main` at `0e87f7b`. No CI workflow, no lint hardening — everything from PR #8 was wiped by the hard reset.

## Strategy

Build the safety net **first**, then redo the lint foundation work that broke prod. The whole point is: never ship the next round of changes without verification that the deployed artifact actually serves what it should.

## Order of execution

1. **Issue #10 — Production smoke gate** (must-have foundation; nothing else ships safely until this exists)
2. **Issue #11 — Dev DB snapshot** (lets us test against real-shape data locally before pushing)
3. **Issue #12 — Visual regression** (catches CSS class of bug)
4. **Re-attempt Issue #1 lint foundation** — narrower scope this time, with all three nets above in place

---

## Issue #10 — Production smoke gate

**GitHub:** https://github.com/jbhirsh/fog-and-frontier/issues/10

### Scope

Add CI job that runs after Vercel preview deploys and is required before merge. Same suite re-runs against prod after merge.

### Canary requests (against preview URL on PR, against `https://fog-and-frontier.vercel.app` after merge)

- `GET /api/activities` → 200 + JSON containing sentinel slug `the-horse-park-at-woodside`
- `GET /api/completed` → 200 + JSON object (may be empty)
- `GET /` → 200, parse `<link rel="stylesheet">`, fetch CSS asset → 200 + body containing expected token (e.g., `--color-primary` or a known Tailwind utility)

### Implementation notes

- **CI workflow goes at `/Users/JessicaHirsh/Code/Activities/.github/workflows/ci.yml`**, NOT inside `fog-and-frontier/`. GitHub Actions only reads `.github/workflows/` at repo root. Use `defaults.run.working-directory: fog-and-frontier`.
- A `package-lock.json` must be committed for deterministic `npm ci`. The user's dotfiles globally gitignore lockfiles — `.gitignore` at repo root needs `!package-lock.json` to override.
- Use `--legacy-peer-deps` for the install — ESLint 10 conflicts with some plugins' peer ranges.
- For discovering the preview URL: query the GitHub deployments API for the latest Vercel "Preview" deployment on the PR head SHA. Alternative: use a Vercel-specific action.
- The smoke script itself should be a Node script (`scripts/smoke.ts` or `.mjs`) that takes a base URL argument and exits nonzero on failure — usable both in CI and locally.
- **No new `/api/health` endpoint.** The real endpoints are the canaries (user's call).

### Acceptance

- A PR that 404s `/api/activities` fails CI
- A PR that ships empty/broken CSS fails CI
- A PR where API runs but returns zero activities fails CI
- Required as branch-protection check — bypass needs explicit admin override
- Same checks run post-merge against prod

---

## Issue #11 — Dev DB snapshot

**GitHub:** https://github.com/jbhirsh/fog-and-frontier/issues/11

### Scope

- `scripts/snapshot-prod-db.ts` reads from Turso via read-only token, writes `dev-db.sqlite` (gitignored)
- **One snapshot taken now**, on 2026-05-10. No automatic refresh. Re-snapshots only on explicit `npm run db:snapshot` (with overwrite warning).
- `api/*.ts` reads from local SQLite when `DEV_DB_PATH` is set (i.e., during `vercel dev`); reads from Turso otherwise
- Dev writes persist to the local file; snapshot script overwrites = explicit reset to prod state

### Implementation notes

- Turso connection lives in `api/_turso.ts` (or equivalent). Find the abstraction layer first — don't duplicate the swap logic across `api/activities.ts` and `api/completed.ts`.
- Vercel env vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`. Need to ensure a **read-only** token for the snapshot script. Either create a separate one in Turso, or use the same one with the understanding that the script is read-only.
- `libsql` Node client can read from a local file URL (`file:./dev-db.sqlite`). Same client, different URL — minimal code change.
- The snapshot dump: query all tables, write `CREATE TABLE` + `INSERT` statements to the local SQLite. Or just use `libsql` export tools if available.

### Acceptance

- `vercel dev` serves real-shape data without touching prod
- The PR #8 row-narrowing bug (dropping non-string IDs) surfaces locally
- Snapshot file gitignored; only script + docs committed

---

## Issue #12 — Visual regression

**GitHub:** https://github.com/jbhirsh/fog-and-frontier/issues/12

### Scope

Playwright `toHaveScreenshot()` against local Vite preview build.

### Pages
- `/` — home/list
- `/activity/[slug]` — detail (one stable slug from the fixture)
- `/explore` — empty state only

### Viewports
- Desktop: 1280×800
- Mobile: 390×844 (iPhone 14/15)

### Failure mode
`maxDiffPixelRatio: 0.01` (1% threshold to absorb font-aliasing flake)

### Data isolation — critical

**Do NOT use the dev snapshot or prod DB for visual tests.** Adding an activity in prod would invalidate visual baselines for unrelated reasons.

- Visual tests run against a **fixed fixture DB** at `tests/visual/fixtures/visual-test-db.sqlite` (committed, never auto-refreshed)
- Hand-curated set: long name, short name, photo/no-photo, completed/not completed
- Tests point `DEV_DB_PATH` at the fixture DB

### Stability
- Wait for `document.fonts.ready`
- Disable CSS transitions/animations in test mode
- No live API/Gemini calls

### Acceptance
- Removing Tailwind base styles produces a flagged diff
- Intentional redesign requires explicit `--update-snapshots` + commit
- Prod data changes have zero effect on visual tests

---

## After #10–#12: Re-attempt Issue #1 lint foundation

**GitHub:** https://github.com/jbhirsh/fog-and-frontier/issues/1 (still open after revert)

### What the original PR did (and what to redo)

Most of it was good. The two specific changes that broke prod:

1. **`api/activities.ts` and `api/completed.ts` row narrowing** — narrowed `row.id` with `typeof === 'string'` and skipped non-string rows. libsql returns IDs as varied types; this dropped ALL rows. **Don't repeat this pattern.** Either don't narrow, or coerce with `String(row.id)`.
2. **`stylelint --fix` on `src/index.css`** — 22 auto-edits including hex shortening, whitespace, and one that interacted badly with Tailwind v4's `@utility`/`@layer` to produce broken CSS in the built output. **Run stylelint without `--fix` first**, fix violations manually, and verify the built CSS still works (visual regression catches this once #12 is in place).

### Safe to re-do

- ESLint config rewrite (jsx-a11y, import plugin, type-checked preset, `no-floating-promises`, `no-misused-promises`, `import/no-cycle`)
- Stylelint config (`.stylelintrc.json` — without running `--fix` blindly)
- `tsconfig.api.json` for type-checking `api/*.ts`
- Package scripts: `lint:js`, `lint:css`, `lint:fix`, build chain
- README updates
- Component a11y fixes: dialog backdrop split into `<button>` + `role="dialog"`, `useEffect→setState` → adjust-during-render, alt text
- `FileReader` Promise tightening in `userPhotos.ts`
- Lazy `useState` initializer in `Explore.tsx`

### Must not repeat

- `eslint-disable` / `ts-ignore` / disabling rules in config — **user's durable global rule, in `~/.claude/CLAUDE.md`**
- Row-shape narrowing that drops data
- `stylelint --fix` on `index.css` without verifying built CSS
- Putting the CI workflow inside `fog-and-frontier/.github/` — must be at repo root

---

## Important durable preferences to keep in mind

- **No lint-rule suppression.** No `eslint-disable`, no `ts-ignore`, no disabling rules in config — ask first. Global rule.
- **PM-review before issue creation.** Read code + `gh issue list` + ask clarifying questions before drafting feature issues. (Already done for #10–#12.)
- **Vercel dev handler style:** Node-style `(req, res)` in `api/*.ts`. Web API style hangs in `vercel dev`.
- **User is on Vercel Hobby plan.** `vercel rollback` (instant promote without rebuild) may not be available. `vercel promote <url>` works on all plans.
- **Today's date:** 2026-05-10.

## Files / locations to know

- Repo root (git): `/Users/JessicaHirsh/Code/Activities/`
- App: `/Users/JessicaHirsh/Code/Activities/fog-and-frontier/`
- CI workflow path (when re-added): `/Users/JessicaHirsh/Code/Activities/.github/workflows/ci.yml`
- Current prod deployment: `dpl_RP7UJzC3Vz8cZL7ytjDWL366QCHt` (`fog-and-frontier-93ejygj4i-jbhirshs-projects.vercel.app`)
