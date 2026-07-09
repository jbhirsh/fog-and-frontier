# Fog & Frontier

**A full-stack map-based tracker for Bay Area adventures — hikes, food, scenic
drives, and culture — with collaborative trip planning and AI-assisted
discovery.**

🌉 **Live demo: [fog-and-frontier.vercel.app](https://fog-and-frontier.vercel.app)**

React 19 + Vite front end · a single consolidated Apollo GraphQL serverless
function · Turso (libSQL) edge database · Clerk auth · Leaflet maps · Sentry
observability · Vitest + Playwright in CI.

![Split view — curated list alongside an interactive Leaflet map](docs/screenshots/home-split.png)

## What it does

Fog & Frontier is a curated catalog of Bay Area outdoor activities you can browse,
map, filter, and plan trips around.

- **Browse & filter** a catalog of curated adventures — filter by distance from
  home, duration, category (hiking, cycling, water, food, culture, scenic,
  climbing, camping), park designation, and dog-friendliness. Results are sorted
  by distance.
- **Three synced views** — a segmented **List · Split · Map** toggle. Split view
  puts the catalog next to a live map; panning/zooming narrows the list to
  what's in view ("Showing N in this area"), and hovering a card highlights its
  map pin and vice-versa.
- **Interactive map** — Leaflet with a CARTO Positron basemap and custom circular
  glyph pins colored by completion status (to-do / completed) and iconed by
  category.
- **Activity detail** — rich detail cards with AllTrails ratings, trail
  stats, park type, and per-activity user photo uploads.
- **Trip planning** — create a trip, invite members, shortlist activities, and
  **vote**; trips move through a `voting → planning → past` lifecycle with a
  day-by-day itinerary (day index, start time, ordering).
- **AI discovery ("Explore")** — pick a date window (today / tomorrow / this
  weekend / next 7 days) and Google Gemini searches for local events to do.
- **Owner-gated editing** — add / edit / delete / mark-complete are gated to
  owners, **enforced server-side** (the client gate is a UI hint only).

## Screenshots

| Full-screen map | Activity detail |
| --- | --- |
| ![Full map view with category glyph pins across the Bay Area](docs/screenshots/map.png) | ![Activity detail modal with AllTrails rating and completion badge](docs/screenshots/activity-detail.png) |

**AI-assisted "Explore" — pick a date window and let Gemini find local events:**

![Explore — Gemini-powered event discovery by date window](docs/screenshots/explore.png)

| Mobile list | Mobile map |
| --- | --- |
| <img src="docs/screenshots/mobile-list.png" alt="Mobile list view" width="270"> | <img src="docs/screenshots/mobile-map.png" alt="Mobile map view" width="270"> |

## Tech stack

| Layer | Technology |
| --- | --- |
| **Front end** | React 19, Vite 8, TypeScript, React Router 7, Tailwind CSS v4 |
| **Maps** | Leaflet + react-leaflet, CARTO Positron basemap |
| **Data layer** | Apollo Client 4, GraphQL, `graphql-codegen` (typed operations) |
| **API** | Apollo Server 5 on Express 5, one Vercel serverless function |
| **Database** | Turso / libSQL edge database (`@libsql/client`) |
| **Auth** | Clerk (`@clerk/clerk-react` + `@clerk/backend`) |
| **AI** | Google Gemini (event discovery + activity generation) |
| **Observability** | Sentry (`@sentry/react`) with source-map upload; structured serverless logging |
| **Testing / CI** | Vitest (unit), Playwright (visual regression), GitHub Actions |
| **Hosting** | Vercel |

## Engineering highlights

A few things in here worth a closer look:

- **Schema-first GraphQL, one function.** Eleven REST endpoints were consolidated
  behind a single Apollo Server handler (`api/graphql.ts`) to stay under Vercel
  Hobby's 12-function cap — schema in `api/_schema.ts`, resolvers in
  `api/_resolvers/*`, typed end-to-end via `graphql-codegen`.
- **Auth you can't bypass from the client.** `requireOwner` (Clerk) gates every
  mutation and paid AI call server-side; the client `useOwner()` hook only
  decides what to *render*.
- **A production safety net born from an outage.** Earlier work shipped a bug that
  404'd the API and blanked the CSS in prod. The response — a **smoke gate**
  (canary checks against the real Vercel deployment, including detection of
  Vercel's no-build cached stubs) and **Playwright visual-regression** on desktop
  and mobile — is documented in [`PLAN.md`](./PLAN.md).
- **A strict, type-checked lint setup with a no-suppressions rule.** ESLint runs
  with type-aware rules, `jsx-a11y`, and import-cycle detection, and the project
  forbids `eslint-disable` / `@ts-ignore` outright. The debugging notes from
  honoring that rule live in [`CALIBER_LEARNINGS.md`](./CALIBER_LEARNINGS.md).
- **Privacy-conscious observability.** Sentry runs with `sendDefaultPii: false`,
  scrubs query strings from breadcrumbs and events, uploads hidden source maps to
  de-minify stack traces, and deletes them from the public bundle at build time.

## Getting started

```sh
npm ci --legacy-peer-deps    # ESLint 10 peer-range mismatches
npm run dev                  # Vite dev server on http://localhost:5173
```

`npm run dev` serves the UI on port 5173 and needs no secrets to boot. The client
calls the GraphQL API at the relative path `/api/graphql`, so to develop against
live data run `vercel dev` (which serves the serverless function) with a
`.env.local` — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). With no Clerk key set,
auth falls back to a public, signed-out mode (owner-only editing controls are
hidden).

Common scripts:

```sh
npm run lint         # ESLint + Stylelint
npm run typecheck    # tsc -b (app + node + api + eval projects)
npm run test         # Vitest unit tests
npm run test:visual  # Playwright visual regression
npm run eval         # Gemini output-quality eval (paid; needs GEMINI_API_KEY)
npm run build        # lint → typecheck → vite build
```

For the full developer guide — architecture, the multi-tsconfig layout, the
Sentry/observability wiring, CI details, and the lint policy — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Output-quality evaluation (Gemini)

The Gemini calls are the one part of the app whose output a type-checker can't
vouch for — a well-formed response can still be wrong. `eval/` is a golden-set
harness (issue #122) that grades what the model actually returns across the
three AI surfaces:

- **`generateActivity`** — turning a title into a structured activity record.
- **`alltrailsLookup`** — pulling rating / distance / elevation for a trail.
- **`discover`** — the "Explore" event search over a date window.

Most of the grading is **mechanical and deterministic**: schema and enum
legality, expected-enum membership (category / region / park type / duration),
coordinate tolerance against a cited source, and the right graceful-failure
codes on adversarial input. On top of that sits a **narrow, temperature-0 LLM
judge** used *only* for the things a check can't assert — the plausibility of a
generated description or a discovered event. Nothing else is judged by a model.

**Generation temperature.** Issue #122 asked for temperature-0 eval calls; the
harness deliberately deviates and exercises the production resolvers at their
production generation settings (temperature 0.4 / 0.1 / 0.5 by surface) — it
measures what actually ships, not a determinized variant of it. The trade-off
is that individual case results rotate run-to-run (typically ~1 case flips
between otherwise-identical runs) while the overall score stays in band, so
compare runs by score, not by which case failed. The judge itself still runs
at temperature 0. A temperature-0 override for the resolver calls is a
possible future refinement.

**How to run:**

```sh
vercel env pull .env.local   # provides GEMINI_API_KEY
npm run eval
```

It makes 22 paid resolver calls plus up to 16 LLM-judge calls per run — worst
case ~38 `gemini-2.5-flash` calls (judges are skipped once a mechanical check
has already failed a case, so most runs use fewer). Fractions of a cent either
way, and **not** part of `npm test` — it's opt-in because it costs money and
hits the network.

**Threshold semantics.** A run passes at **90%** by default, overridable with
`EVAL_THRESHOLD` or `--threshold` — both take a fraction (e.g. `0.85`), not a
percentage. Infrastructure errors (transport failures, a
judge that dies after retry, per-case timeouts) are **excluded from the
denominator** so flaky infra can't fail the quality gate — but if they collapse
too much of the set, the run is reported **inconclusive** and exits non-zero
below an **80% graded floor**.

**CI.** `.github/workflows/eval.yml` runs the eval on PRs that touch the Gemini
resolver, its schema, or `eval/**`, and on manual dispatch. There's no schedule
(the calls are paid), and it **skips green** when `GEMINI_API_KEY` is absent
(forks, or the secret unset), so it never blocks contributors who can't make the
calls.

**Golden set status.** The golden set is **DRAFT — pending owner review**; each
case cites the provenance of its expected coordinates/data and an as-of date.

**Known limitations.** The plausibility judge is Gemini grading Gemini. Its
rubric was calibrated during owner review (2026-07-10) after three consecutive
runs each failed a *different* true-but-unlisted fact (Big Basin's reservation
system, Duarte's cioppino/1930s restaurant era, Castle Rock's world-class
climbing reputation): the judge now passes widely-documented famous attributes
even when a case's notes omit them, fails anything false/contradictory, and
still fails obscure specifics it can't verify. That leans on the judge's own
knowledge of famous places — a deliberate trade, documented in
`eval/judge.ts`. One case is marked `xfail` (expected failure) to document
that the response schema forces the model to fabricate a record on
pure-nonsense input rather than decline.

**Current score: 95.5%** (21/22 graded, threshold 90%) — recorded by the
gating CI run of 2026-07-10 (eval workflow run 29061551986). Because the
resolvers are evaluated at their production temperatures (see above), *which*
case fails rotates run-to-run — the ≥90% threshold is the contract, not any
single case's verdict. Findings, reported as-is per issue #122 ("failures are
real signal"):

- On the gating CI run, `disc-week` failed `judge:events` (7/11 plausible) —
  a **judge bug, not a model finding**: lacking today's date, the judge graded
  events named "2026" as contradicting their own dates. Fixed since: the
  events judge now gets a "Today is <date>" preamble and each event's ISO
  `startDate`.
- Other runs have surfaced **genuine model findings** — e.g. `gen-muir-woods`
  failing `judge:descriptions` after the generated description called the
  trees "thousands of years old," when Muir Woods' oldest redwoods are ~1,200
  years (NPS). Left standing deliberately; enriching the case can't and
  shouldn't fix a model exaggeration.
- `gen-nonsense` fails as predicted on every run (counted via its `xfail`
  annotation): the response schema offers no refusal affordance, so the model
  fabricates a record for garbage input. Candidate follow-up: a
  refusal/uncertainty field in `ACTIVITY_SCHEMA`.

## Project structure

```
src/            React app — pages/, components/, lib/ (hooks + data layer), gql/ (generated)
api/            Apollo GraphQL serverless function — _schema.ts, _resolvers/*, _auth.ts, _db.ts
scripts/        DB snapshot / seed / migration helpers, CI smoke script
tests/visual/   Playwright visual-regression specs + baselines
docs/           Screenshots
```

## About

A personal project built and maintained with a
[Claude Code](https://claude.com/claude-code) workflow — see
[`CLAUDE.md`](./CLAUDE.md) for the working conventions and
[`CALIBER_LEARNINGS.md`](./CALIBER_LEARNINGS.md) for accumulated engineering
notes.
