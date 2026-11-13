# Contributing

## Setup

Node 24, as CI uses (`.nvmrc`).

```sh
git clone https://github.com/jbhirsh/fog-and-frontier.git
cd fog-and-frontier
npm ci                              # exactly what package-lock.json pins; points core.hooksPath at .githooks/
cp .env.local.example .env.local    # fill in what you need; never commit it
npm run dev                         # Vite on http://localhost:5173
```

The visual tests and the PR GIFs run in WebKit, Safari's engine: install it once with
`npx playwright install --with-deps webkit` (on Linux, `--with-deps` adds its system libraries).

`npm run dev` needs no secrets. Outside a build Vercel makes (production, a preview, `vercel dev`)
the app is signed out with no sign-in offered (`src/lib/authShim.ts`), so owner controls are
hidden. The client calls the API at `/api/graphql`, which plain Vite doesn't serve: for data, run
`vercel dev`, which serves the function, with `.env.local` (`vercel env pull .env.local` brings
the project's variables down). Set `DEV_DB_PATH` to a local SQLite snapshot
(`npm run db:snapshot`) to read a file instead of Turso.

`.env.local.example` lists every variable, with what each does and which environment holds it.
Sentry's are set in Vercel:

| Variable                     | Where                         | Purpose                                                                                                                       |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SENTRY_DSN`            | Vercel (all environments)     | Turns on browser Sentry; leave it out locally                                                                                 |
| `SENTRY_AUTH_TOKEN`          | Vercel (build, all)           | Lets `@sentry/vite-plugin` upload the hidden source maps (scope `project:releases`, from Sentry → Settings → Auth Tokens)     |
| `VITE_VERCEL_ENV`            | injected from `VERCEL_ENV`    | Sentry's environment tag; on a deployment it also turns on sign-in and the image CDN for covers (`vite.config.ts`'s `define`) |
| `VITE_VERCEL_GIT_COMMIT_SHA` | injected from the build's SHA | Sentry's release, so stack frames map to the source                                                                           |

## Commands

| Command                                                      | What it does                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `npm run preview`                            | the Vite dev server / the production build, served locally                                                |
| `npm run build`                                              | lint, `tsc -b`, then `vite build`                                                                         |
| `npm run typecheck` / `npm run typecov`                      | `tsc -b` over every project (`tsconfig.json` lists them) / type coverage at 100% over the app and the API |
| `npm run lint` / `npm run lint:fix`                          | ESLint and Stylelint / their fixes (check the CSS diff: below)                                            |
| `npm run format` / `npm run format:check`                    | Prettier over the whole repo                                                                              |
| `npm run depcruise`                                          | the import layering rules (`.dependency-cruiser.cjs`)                                                     |
| `npm run codegen`                                            | typed GraphQL operations into `src/gql/` from `api/_schema.ts`                                            |
| `npm test` / `npm run test:watch` / `npm run test:coverage`  | Vitest; only `test:coverage` applies the 80% per-file gate CI runs                                        |
| `npm run test:mutation`                                      | StrykerJS over the files coverage measures (`stryker.config.json`)                                        |
| `npm run test:visual` / `npm run test:visual:update`         | Playwright visual regression in WebKit against a `--mode test` build (baselines come from CI: below)      |
| `npx knip` / `npm run jscpd`                                 | the weekly audit's unused-code and duplication checks, expected to report nothing                         |
| `npm run eval`                                               | the Gemini eval (paid; below)                                                                             |
| `npm run gif -- <scenario.ts> --dir <PR>`                    | a PR's before/after GIFs, recorded by jbhirsh/ci's `gif` tool (`scripts/gif.mjs`; needs ffmpeg, WebKit)   |
| `npm run db:snapshot` / `npm run db:seed-preview`            | production's Turso into `dev-db.sqlite` / the preview database seeded from production                     |
| `npm run cards -- draft` / `save` (`cards -- dogs draft`...) | card copy (#295) and dog rules (#296) for places saved without them, through a review file                |
| `npm run regions:gen`                                        | `shared/isoRegions.ts` from ISO 3166 (needs Debian's `iso-codes`)                                         |
| `npm run icons:gen -- <name>…`                               | `src/lib/iconPaths.ts`: adds icons, or with no names fetches them all again                               |
| `npm run links:check` / `npm run instagram:check`            | every outbound link in the live catalog (#68) / Instagram's pages as sharing reads them (#6); both weekly |

The git hooks run Prettier on the staged files, ESLint, Stylelint, the layering rules and
`tsc -b` on commit, and the tests under the coverage gate plus the build on push; both do
nothing when `$CI` is set.

**Don't run `lint:fix` on the CSS blind.** `src/index.css` uses Tailwind 4's `@theme`, `@utility`
and `@layer`, so Stylelint has only `stylelint-config-recommended`'s structural rules: an earlier
`--fix` over that file shipped broken CSS to production (#1). Read the CSS diff, and let the visual
tests check the built CSS.

## Tests

- **Unit tests** sit beside their source (`*.test.ts(x)`, property tests in
  `*.property.test.ts`), run by Vitest in jsdom with React Testing Library.
- **Coverage** measures `src/`, `api/`, `shared/`, `scripts/` and `eval/` at 80% per file, apart
  from entry points, generated code and a backlog of files that predate the gate
  (`vite.config.ts`), which may only shrink: `src/test/coverageBacklog.test.ts` pins it.
- **Mutation testing** (`mutation.yml`) mutates the lines a PR changed in the files coverage
  measures, and a monthly sweep (`mutation-sweep.yml`) covers everything.
- **Visual regression** (`npm run test:visual`, `playwright.config.ts` says what it runs) compares
  against Linux baselines that only CI writes: run **Update visual baselines**
  (`visual-baselines.yml`) by hand on the branch, which commits them there, then approve the
  checks its push starts on the PR.

### The Gemini eval

The Gemini calls are the one part of the app whose output a type-checker can't vouch for: a
well-formed response can still be wrong. `eval/` is a golden-set harness (#122) that grades what
the model returns across four surfaces:

- **`generateActivity`**: a title turned into a structured activity record.
- **`alltrailsLookup`**: a trail's rating, distance and elevation.
- **`discover`**: Explore's event search over a date window.
- **`tripSuggestions`**: catalog activities ranked for a new trip's request (#78), over a fixed
  catalog: the picks must include a clear fit and nothing that breaks a hard constraint like
  "dogs" or "indoors".

Most grading is mechanical: schema and enum legality, expected categories, regions, park types
and durations, coordinates within tolerance of a cited source, and the right failure codes on
adversarial input. A narrow, search-grounded LLM judge grades only what a check can't: whether a
generated description or a discovered event is plausible.

**Settings.** The resolvers call `gemini-3.8-flash` with Google Search and URL context, so they
look facts up and read the links they're given, with a JSON schema shaping every reply; trip
suggestions only choose from the catalog, so they search nothing. #122 asked for temperature-0
calls; the harness instead runs the production resolvers at their production settings (Gemini 3.8
Flash ignores temperature, and search results are live), so it measures what ships. Individual
cases rotate run to run (typically about one flips) while the score stays in band: compare runs by
score, not by which case failed. The judge also runs on `gemini-3.8-flash` with Google Search.

**Running it:**

```sh
vercel env pull .env.local                             # provides GEMINI_API_KEY
npm run eval                                           # every case, judged
npm run eval -- --hikes --no-judge                     # the 7 hikes, graded on their AllTrails link
npm run eval -- --parks --no-judge                     # the 8 drafts graded on their park (or none)
npm run eval -- --feature generateActivity --no-judge  # every draft, unjudged
```

`--no-judge` drops the judge calls, about 40% of a full run's cost, for a change that can't affect
the descriptions they grade; run with them when the prompt or model changes. Each run ends with its
usage: drafts, the Google and AllTrails searches they ran, judge calls, tokens, where a draft's
time went, and roughly what its searches cost past Google's free ones. A full run has 26 cases, 22
of them paid Gemini calls, plus up to 19 judge calls (skipped once a mechanical check has failed a
case). A Google search costs about $14 per 1,000 past the month's first 5,000 and an AllTrails
search about $4 per 1,000, so a full run costs about $2, `--no-judge` about $1 and
`--hikes --no-judge` well under that. It isn't part of `npm test`: it costs money and uses the
network.

Cases run four at a time (`EVAL_CONCURRENCY` or `--concurrency`; `1` runs them in turn). Each
event line a case logs prints after its case's id, and is graded with that case alone.

**Thresholds.** A run passes at 90% (`EVAL_THRESHOLD` or `--threshold`, as a fraction such as
`0.85`). Infrastructure errors (transport failures, a judge that dies after its retry, per-case
timeouts) leave the denominator, so flaky infrastructure can't fail the gate; but if they take too
much of the set, the run is inconclusive and fails below an 80% graded floor.

**CI.** `eval.yml` runs only by hand (Run workflow, on the branch to grade): `hikes` or `parks`
(the cheapest, unjudged), `drafts` (every draft, unjudged) or `full`. It once ran on pushes to
ready PRs touching the AI code, which hit the project's monthly spend cap more than once on one PR.
Grade a PR once its AI changes are settled, and only as much as the change can affect; a change
that can't reach Gemini's answers needs no run. It has no schedule, skips green without
`GEMINI_API_KEY`, and searches AllTrails only with `AGENT_SEARCH_API_KEY` set too.

The golden set's review history, the judge's calibration and past scores are in the headers of
`eval/run-eval.ts` and `eval/judge.ts`.

## Required checks

`main` takes a PR only once these pass:

| Check (workflow)                                       | What it runs                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test` (`ci.yml`)                                      | commit messages, autofix triggers, pins, lint, Prettier, layering, type-check, type coverage, codegen drift, unit tests with coverage, build, bundle budget, `npm audit --omit=dev` (high and up)                          |
| `Claude Review` (`claude-review.yml`)                  | jbhirsh/ci's AI review; this repo's guide is `.github/claude-review.md`                                                                                                                                                    |
| `Mutation Tests (Stryker)` (`mutation.yml`)            | mutation testing of the lines a PR changed                                                                                                                                                                                 |
| `visual` (`visual.yml`)                                | Playwright visual regression                                                                                                                                                                                               |
| `smoke` (`smoke.yml`)                                  | canary checks against the PR's Vercel preview (real data from `/api/graphql`, an anonymous trips query refused, the HTML linking built CSS), catching Vercel's no-build cached stubs; again against production after merge |
| `Secret scan` (`gitleaks.yml`), `Scan` (`semgrep.yml`) | secrets and static analysis                                                                                                                                                                                                |
| `Vercel`                                               | the preview deploy                                                                                                                                                                                                         |

The ruleset also asks for a linear history, resolved review threads, CodeQL with no high alerts
and 80% coverage on GitHub's code coverage rule (the `test` job uploads its report). **PR visuals**
(`pr-visuals.yml`) fails a UI change with no pictures in its description, and its message says how
to record them; it isn't a required check.

## Deployment

Vercel (`vercel.json`): the SPA from `dist/`, every non-API route falling back to `index.html`,
`/api/auth/*` rewritten to the one function, and the image CDN's sizes and allowed photo hosts.
Every PR gets a preview, reading the preview Turso database (seed it from production with
`npm run db:seed-preview` after rotating its credentials or adding activities the smoke gate
needs), and `main` deploys to production. Production builds upload hidden source maps to Sentry
and delete them from `dist/` before Vercel publishes.

## Dependency updates

Dependabot (`.github/dependabot.yml`, whose header says why) opens one grouped PR per ecosystem
each Monday at 06:00 UTC, majors included, and a security group as soon as an alert fires.

- **npm PRs merge themselves**: `claude-autofix.yml` turns on auto-merge once the first check
  completes, GitHub merges once every required check is green and every thread resolved, and a
  red check is handed to autofix on the PR's branch. Nothing to do unless one stays open.
- **GitHub Actions PRs are merged by hand**, since the Actions token can't merge a change to
  `.github/workflows/`: skim a major's release notes, check CI, merge.

When a grouped npm PR is stuck, read the failing check: usually one package's major. If that major
waits on another package's peer range, give it a `blocked-<package>` group in `dependabot.yml`
naming what it waits on; it gets a PR of its own, red until that package catches up, and merges
itself once green. If it needs code changes, upgrade it in its own PR. The blocked groups today are
`blocked-graphql` (until Apollo Server takes graphql 17) and `blocked-typescript` (until
typescript-eslint and type-coverage take TypeScript 7); their red PRs aren't stuck.

## One-time setup

- **Actions secrets:** `CLAUDE_CODE_OAUTH_TOKEN` (Claude Review and autofix), `GEMINI_API_KEY`
  and `AGENT_SEARCH_API_KEY` (the eval), `VERCEL_AUTOMATION_BYPASS_SECRET` (lets the smoke gate
  through Vercel Authentication on previews), `VERCEL_TOKEN` (optional: the smoke gate inspects a
  failed deployment with it), and `BOT_PR_TOKEN`, a fine-grained token for this repository with
  Contents and Pull requests read and write. The README screenshot bot opens its PR from
  `bot/readme-screenshots` with it: a PR the default Actions token opens starts no workflows, so
  its required checks would never report and it would never merge. Without it the default token
  is used, which works at all only with Settings → Actions → General: "Allow GitHub Actions to
  create and approve pull requests".
- **Pages:** Settings → Pages: Deploy from a branch, `job-reports`, `/ (root)`, for each job's
  report.
- **The `screenshots` branch** hosts every PR's pictures, in a folder named for the PR
  (`<number>/`; older PRs' pictures, once on `pr-screenshots/<topic>` branches, are under
  `<topic>/`), linked at a commit SHA so a later push can't change what a PR shows. Its tree holds
  a `vercel.json` of `{"git":{"deploymentEnabled":false}}`, so it costs no deploy.
- **Sentry:** install the GitHub integration on this repository (Sentry → Settings →
  Integrations → GitHub) and add a code mapping (the project, branch `main`, source root `./`,
  stack-trace root usually `~/`), so frames link to the source and Sentry comments on PRs touching
  code with open issues. For alerts: Vercel → Project → Observability → Alerts on `/api/*` 5xx
  spikes, and Sentry's Issue Owners alerts with its weekly digest.
- **The shared Claude rules:** sessions read them from jbhirsh/ci; on your own computer, link
  them once as its `CONTRIBUTING.md` says ("The shared Claude rules").
- **Blame:** `git config blame.ignoreRevsFile .git-blame-ignore-revs`, so local blame skips the
  one-time reformat (GitHub's blame already does).
