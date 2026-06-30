import type { CodegenConfig } from '@graphql-codegen/cli';

// Typed GraphQL operations for the Apollo Client 4 data layer (issue #91).
// Schema is the frozen SDL contract in api/_schema.ts (read-only here — the
// Server lane owns it); operations are colocated in src via the `graphql()`
// function the client-preset generates into src/gql/.
//
// Custom scalars map to `string` on the client: DateTimeISO is an ISO-8601
// string, Date is 'YYYY-MM-DD', LocalTime is 'HH:MM' — none are JS Dates.
const config: CodegenConfig = {
  schema: './api/_schema.ts',
  documents: ['src/**/*.{ts,tsx}', '!src/gql/**'],
  ignoreNoDocuments: true,
  generates: {
    './src/gql/': {
      preset: 'client',
      presetConfig: {
        // Plain expanded types (no useFragment ceremony). We still define
        // fragments for cache consistency; we just don't mask them.
        fragmentMasking: false,
      },
      config: {
        useTypeImports: true,
        enumsAsTypes: true,
        scalars: {
          DateTimeISO: 'string',
          Date: 'string',
          LocalTime: 'string',
        },
      },
    },
  },
};

export default config;
