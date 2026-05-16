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
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/data/activities.ts',
        'src/data/types.ts',
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
