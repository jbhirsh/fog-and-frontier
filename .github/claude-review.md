This is "Fog and Frontier", a personal West Coast adventures app: Vite +
React 19 + TypeScript on the front end, a single Vercel serverless function
in `api/` (`api/graphql.ts`, an Apollo Server on Express, schema in
`api/_schema.ts`, resolvers in `api/_resolvers/*`), Turso (libSQL) for
persistence, and Clerk for auth.

### Focus

- Logic errors and edge cases in resolvers, reducers and pure utilities.
- GraphQL: resolvers that don't match `api/_schema.ts`. Resolvers aren't
  typed from the schema, so the type-check doesn't catch a mismatch.

### Auth model (critical — get this right)

- The server gates are in `api/_gqlContext.ts`. Any mutating resolver or
  paid/external call (e.g. Gemini) MUST be guarded server-side by
  `requireOwnerCtx` (or `requireMemberCtx` / `requireCreatorCtx` for
  trip-scoped actions, or `requireUserCtx` where something else authorizes
  the write, e.g. `claimInvite`'s invite token, or where CLAUDE.md records
  the decision, as for suggestions and their capped drafts). `useOwner()` in
  `src/lib/useOwner.ts` is a UI hint ONLY, never the real authorization.
  Flag any mutating resolver path that reaches a write or paid call without
  one of these guards, and any code that treats the client-side owner check
  as if it were enforcement.

### Role-gated UI (hide, don't grey out)

- Owner-guarded _mutating_ controls (add / edit / delete / other writes)
  must be **hidden** from non-owners: gate the JSX on `isOwner` (e.g.
  `{isOwner && <button …/>}`). Flag any owner-gated write control rendered
  as `disabled={!isOwner}` or with a "Sign in to edit"-style tooltip; that
  convention was deliberately reversed (#67).
- Sign-in-gated CTAs follow the same hide rule for signed-out visitors
  (#112): flag one rendered disabled or with a "Sign in to…" tooltip.
- _Reads_ stay visible to everyone; only the write affordance inside them
  is hidden.
- Do NOT flag trip-creator-gated controls in `TripDetail`: a per-trip role
  that keeps its existing presentation.

### Database writes

A multi-write DB path must be a single batched write, and its test should
assert one `db().batch(stmts, 'write')` (see `transitionToPast` /
`createTrip` / `patchTrip`). Flag multi-write resolvers that issue separate
writes instead of one batch, or that lack the single-batch assertion.

### Where the data lives

Turso holds live production data. Tables are created in code with
`CREATE TABLE IF NOT EXISTS` (see `api/_trips.ts`), which does nothing to a
table that already exists, so a column added to one of those statements
never reaches production on its own: flag a schema change without a
migration that applies it to the existing table, and a renamed or removed
column or table that existing rows or other readers still depend on.
Activities are stored as JSON in table `a` (column `j`), so renaming or
removing an Activity field breaks existing rows with no schema change at
all; flag that unless loading still accepts the old shape. The browser also
keeps the user's photos only in localStorage (`fogandfrontier.userPhotos.v1`,
`src/lib/userPhotos.ts`); renaming the key or changing its shape loses them.
