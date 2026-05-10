# Fog and Frontier

A personal map of Bay Area adventures — curated hikes, completed trips, and discoverable events. Built with React + Vite + Tailwind v4, deployed on Vercel, with a tiny Vercel Functions API backed by Turso.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Lint, type-check (`tsc -b`), then production bundle |
| `npm run lint` | Run ESLint + Stylelint |
| `npm run lint:js` | ESLint only (TS/TSX) |
| `npm run lint:css` | Stylelint only (`src/**/*.css`) |
| `npm run lint:fix` | Auto-fix everything fixable |
| `npm test` | Vitest run |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Vitest with V8 coverage |

`npm run build` runs `lint` first — a broken lint blocks a build.

## What each linter covers

- **ESLint** (`eslint.config.js`): TypeScript + React Hooks (`react-hooks`), accessibility (`jsx-a11y`), import hygiene (`import/no-cycle`, `import/no-unresolved`), and type-aware rules including `@typescript-eslint/no-floating-promises` and `no-misused-promises`. Uses the typescript-eslint *type-checked* preset.
- **Stylelint** (`.stylelintrc.json`): `stylelint-config-standard` with Tailwind v4 at-rules (`@theme`, `@layer`, `@utility`, `@variant`, `@apply`, …) allowed.

## CI

`.github/workflows/ci.yml` (at the repo root, one level above this directory) runs `lint`, `test`, and `build` on every PR to `main` and every push to `main`. PRs cannot merge if any of those fail.

`package-lock.json` is committed in this repo (the root `.gitignore` overrides the user's global lockfile ignore) so CI installs are deterministic via `npm ci`.
