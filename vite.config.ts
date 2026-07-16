/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Vercel auto-injects VERCEL_GIT_COMMIT_SHA + VERCEL_ENV at build time. Surface
// them to the client as VITE_* so initSentry() can tag release + environment
// without manual env-var config in the Vercel dashboard.
const release = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
const vercelEnv = process.env.VERCEL_ENV ?? '';
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Source-map upload runs only when SENTRY_AUTH_TOKEN is present (Vercel
    // build env). Local builds skip it cleanly — no warning, no failed call.
    ...(sentryAuthToken
      ? [
          sentryVitePlugin({
            org: 'solo-23',
            project: 'fog_and_frontier',
            authToken: sentryAuthToken,
            release: { name: release || undefined },
            // Maps are emitted to dist/ for upload, then deleted before
            // Vercel publishes — they never reach the public URL space.
            sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          }),
        ]
      : []),
  ],
  build: {
    // 'hidden' generates source maps without a `//# sourceMappingURL=` in the
    // JS. The Vite plugin still uploads them; browsers can't fetch them.
    sourcemap: 'hidden',
  },
  define: {
    'import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA': JSON.stringify(release),
    'import.meta.env.VITE_VERCEL_ENV': JSON.stringify(vercelEnv),
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: !!process.env.PORT,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/**',
      'fog-and-frontier/**',
      'tests/visual/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // The `api/**` serverless code is now measured alongside `src/**`. The
      // 80% per-file gate below is UNCHANGED; the excludes fall into three
      // groups: non-code/entry files, generated artifacts, and a documented
      // "coverage backlog" of files that predate the gate being enforced in CI
      // (CI used to run `npm test`, which skips coverage, so the gate never
      // actually held). Shrink the backlog as tests land — do NOT lower the
      // thresholds and do NOT add newly-written files to it.
      include: ['src/**/*.{ts,tsx}', 'api/**/*.ts'],
      exclude: [
        // Entry points / non-executable / test scaffolding.
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/data/activities.ts',
        'src/data/types.ts',
        'api/**/*.test.ts',
        'api/_schema.ts', // SDL string — no executable branches.
        // Generated artifacts (graphql-codegen client-preset), like eslint's
        // globalIgnores for src/gql.
        'src/gql/**',
        // ---- Coverage backlog: pre-existing files below the 80% per-file gate
        // when it was first enforced in CI. Tracked for follow-up; each removal
        // must come with real tests, never a threshold change. ----
        // api/ — the rest of api/** IS gated; these are the genuinely-hard ones:
        'api/_db.ts', //         real libSQL client; mocked in every test, no unit seam.
        'api/_gqlMap.ts', //     large snapshot/camelCase mapper, many null-coercion branches.
        'api/_resolvers/gemini.ts', // external Gemini + Wikipedia fetch branches.
        'api/_trips.ts', //      ~1.2k-line module; lines/stmts pass, branch-only miss over many validation paths.
        'api/graphql.ts', //     express error-middleware + formatError paths need failure injection.
        // src/components/ (map + dialog UI, largely untested)
        'src/components/ActivityCard.tsx',
        'src/components/ActivityDetail.tsx',
        'src/components/ActivityMap.tsx',
        'src/components/AddActivity.tsx',
        'src/components/AddToTripDialog.tsx',
        'src/components/AddToTripDropdown.tsx',
        'src/components/InviteModal.tsx',
        'src/components/Layout.tsx',
        'src/components/MapZoomControls.tsx',
        'src/components/TripActivityCard.tsx',
        'src/components/TripMap.tsx',
        'src/components/VoteControls.tsx',
        'src/components/VotingCandidateCard.tsx',
        // src/lib/
        'src/lib/alltrails.ts',
        'src/lib/apolloClient.ts',
        'src/lib/authShim.ts',
        'src/lib/authShimClerk.tsx',
        'src/lib/generateActivity.ts',
        'src/lib/gqlError.ts',
        'src/lib/mapPins.ts',
        'src/lib/userActivities.ts',
        'src/lib/userPhotos.ts',
        'src/lib/userTrips.ts',
        'src/lib/useTripMembership.ts',
        'src/lib/useVisibilityInterval.ts',
        // src/pages/
        'src/pages/CuratedAdventures.tsx',
        'src/pages/Explore.tsx',
        'src/pages/NewTrip.tsx',
        'src/pages/TripDetail.tsx',
        'src/pages/Trips.tsx',
      ],
      thresholds: {
        perFile: true,
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
