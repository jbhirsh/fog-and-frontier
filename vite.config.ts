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
      // Stryker's sandbox copies of the repo (npm run test:mutation).
      '.stryker-tmp*/**',
    ],
    coverage: {
      provider: 'v8',
      // Cobertura is what ci.yml uploads to GitHub for the code coverage rule
      // on main.
      reporter: ['text', 'html', 'json-summary', 'cobertura'],
      include: [
        'src/**/*.{ts,tsx}',
        'api/**/*.ts',
        'shared/**/*.ts',
        'scripts/**/*.{ts,mjs}',
        'eval/**/*.ts',
      ],
      exclude: [
        // Entry points / non-executable / test scaffolding.
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/data/types.ts',
        'api/**/*.test.ts',
        'api/_schema.ts', // SDL string — no executable branches.
        'scripts/**/*.test.{ts,mjs}',
        'eval/**/*.test.ts',
        // Recorded flows for npm run gif, run in a browser by jbhirsh/ci's gif
        // tool, as tests/visual's specs are by Playwright: data, not logic.
        'scripts/gif-scenarios/**',
        // Generated artifacts (graphql-codegen client-preset), like eslint's
        // globalIgnores for src/gql.
        'src/gql/**',
        'shared/isoRegions.ts', // npm run regions:gen writes it from ISO 3166.
        'src/lib/iconPaths.ts', // npm run icons:gen writes it from Material Symbols.
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
