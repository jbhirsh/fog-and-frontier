# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project

**Fog and Frontier** — a personal West Coast adventures app. Vite + React 19 + TypeScript on the front end, Vercel serverless functions in `api/`, Turso (libSQL) for persistence, Clerk for auth, Leaflet for maps.

Not a Next.js project. Not Edge runtime. API handlers are Node-style `(req, res)` in `api/*.ts`.

## Scripts

- `npm run dev` — Vite dev server. For full-stack local dev (API + client) use `vercel dev`.
- `npm run build` — `tsc -b && vite build`.
- `npm run lint` — ESLint flat config.
- `npm test` / `test:watch` / `test:coverage` — Vitest.
- `npm run test:visual` — Playwright visual regression.
- `npm run db:snapshot` / `db:seed-preview` / `db:migrate-static` — Turso helpers in `scripts/`.

## Layout

- `src/` — React app. `src/pages/`, `src/components/`, `src/lib/`, `src/data/types.ts` (Activity model).
- `api/` — Vercel functions. `_auth.ts` has `requireOwner` (Clerk-backed server gate). `_db.ts` is the Turso client.
- `public/` — static assets.
- `scripts/` — DB / migration helpers (Node, `--experimental-strip-types` for `.mts/.ts`).
- `tests/` — Playwright visual specs. Unit tests live next to source as `*.test.ts(x)`.

## Auth model

- Server-side: `requireOwner` in `api/_auth.ts` is the real gate for any mutating endpoint or paid call (e.g. Gemini).
- Client-side: `useOwner()` in `src/lib/useOwner.ts` is a UI hint only. Owner emails come from `VITE_OWNER_EMAILS`.
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
- **Reads stay.** If a surface is a *read* (viewing data — e.g. the "Your
  Photos" gallery, or a completion-status badge), keep it visible to everyone;
  only the *write* affordance inside it (the "Add photos" upload control) is
  hidden. The completion **status** in `ActivityDetail` is rendered as a
  static badge for non-owners; only the interactive toggle is owner-only.
- **There are no owner-only reads today** (no CSV export / admin view). If one
  is added, make an explicit decision (hide vs. keep) and document it here.

Gates that are **not** the owner gate, and keep their existing presentation:

- **Sign-in-gated CTAs** (`useTripMembership` / "is signed in"), e.g. "Select
  for trip" and "Add to trip" in `CuratedAdventures`. These prompt any visitor
  to sign in and legitimately stay rendered (disabled + "Sign in to…" tooltip).
- **Trip-creator-gated** controls in `TripDetail` (reopen voting, mark past,
  delete trip, finalize voting, remove member) — gated on being *this trip's*
  creator, a per-trip role shown to trip members, not the global owner gate.

**Server is the real gate.** `useOwner()` is a UI hint only. `requireOwner` in
`api/_auth.ts` is the actual enforcement and is unchanged by any of the above —
hiding a control never replaces server-side authorization.

- Visual regression: owner-gated UI is exercised in Playwright via the
  dev/test-only `window.__TEST_FORCE_OWNER__` flag (see `src/lib/useOwner.ts`).
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
- Never silence lint or type-checker rules without asking first (no `eslint-disable`, no `@ts-ignore`, no rule downgrades in config).
- Before raising a PR, squash noisy commits (fixups, reverts, "address review") into a clean history.
- After `gh pr create`, spawn a review subagent to read the diff before reporting back.
