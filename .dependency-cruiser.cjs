/**
 * Architecture rules (dependency-cruiser). CONTRIBUTING.md / CLAUDE.md describe
 * the layering as prose — "src/ is the React app", "api/ is the GraphQL
 * function", "src/lib holds hooks and pure helpers", "src/data/types.ts is the
 * Activity model" — and the AI review re-checks it per PR, but nothing failed a
 * build on a violation. eslint's `import/no-cycle` catches cycles within each
 * lint group; these rules make the *cross-layer* boundaries computational too:
 *
 *   api ⇹ src                     (serverless function and browser SPA stay separate)
 *   src/lib ↛ src/components|pages (helpers/hooks sit under the UI, not beside it)
 *   src/data → src/data           (leaf: the Activity model + static constants)
 *
 * CommonJS (.cjs) because the package is "type": "module" and
 * dependency-cruiser loads its config via require().
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies make modules impossible to reason about or test in isolation.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'api-isolated-from-src',
      severity: 'error',
      comment:
        'The GraphQL function (api/) is bundled and run on Vercel Node; importing from src/ would drag DOM/React code into the serverless runtime. The SPA is reached over HTTP (/api/graphql), never by import.',
      from: { path: '^api/' },
      to: { path: '^src/' },
    },
    {
      name: 'src-no-api-imports',
      severity: 'error',
      comment:
        'The browser bundle talks to the API over HTTP (Apollo Client → /api/graphql), never by importing server code. Pulling api/ into src/ would ship Node/Express/libSQL into the client.',
      from: { path: '^src/' },
      to: { path: '^api/' },
    },
    {
      name: 'lib-no-ui',
      severity: 'error',
      comment:
        'src/lib holds hooks and pure helpers that sit *under* the UI: it may not depend on components/ or pages/ at runtime (a type-only import of a shared type, e.g. ViewMode, is allowed — it erases at build time and pulls no UI into the bundle).',
      from: { path: '^src/lib/' },
      to: {
        path: '^src/(components|pages)/',
        dependencyTypesNot: ['type-only'],
      },
    },
    {
      name: 'data-is-leaf',
      severity: 'error',
      comment:
        'src/data is the static source of truth (the Activity model + seed data); it must not depend on app code (lib, components, pages, api).',
      from: { path: '^src/data/' },
      to: { path: '^(src|api)/', pathNot: '^src/data/' },
    },
    {
      name: 'data-no-react',
      severity: 'error',
      comment:
        'src/data holds compiled-in constants and types only — no React, no framework.',
      from: { path: '^src/data/' },
      to: { path: '^node_modules/(react|react-dom|react-router|react-router-dom|react-leaflet)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    // The solution tsconfig references the app/api/node/eval projects; combined
    // with the extensionAlias below it lets the cruiser resolve both src/*.tsx
    // and the api/*.ts files that import siblings with a `.js` extension.
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
  },
};
