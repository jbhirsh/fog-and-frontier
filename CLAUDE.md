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
- Role-gated UI convention: see open issues; mutating affordances are rendered disabled with a tooltip rather than hidden, with a documented exception for admin-flavored owner-only *reads*.

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
