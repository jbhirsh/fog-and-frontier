# CLAUDE.md

**Fog and Frontier**: a personal West Coast adventures app, React 19 + TypeScript + Vite on
Vercel with one GraphQL function, Turso (libSQL), Better Auth and Leaflet. The shared rules every
repo here follows come from jbhirsh/ci (`claude-rules/CLAUDE.md`); setup, the commands, the
required checks and one-time settings are in `CONTRIBUTING.md`. Each module's header says what it
does and why: read it before changing the module.

## Commands that aren't obvious

- `npm test` skips the 80% per-file coverage gate CI runs; `npm run test:coverage` applies it.
- `npm run codegen` after changing `api/_schema.ts` or an operation, and commit `src/gql/`.
- Changing owner-gated presentation changes the visual baselines.
- `shared/isoRegions.ts` is generated (`npm run regions:gen`): never hand-edit it.
- `src/lib/iconPaths.ts` is generated too: an icon `<Icon>` doesn't have yet is a type error, and
  `npm run icons:gen -- <name>` adds it (`scripts/gen-icons.ts` says how).
- The catalog lives only in Turso, with no static seed.

## Where names don't tell

- `api/graphql.ts` is the one Vercel function (Apollo Server on Express, #91): SDL in
  `api/_schema.ts`, resolvers in `api/_resolvers/`. The `api/_*.ts` files are its helpers, not
  functions (Vercel skips `_` files). Not Next.js, not the Edge runtime.
- `api/_gqlContext.ts` holds the server's auth gates; `api/_betterAuth.ts` sign-in, its preview
  proxy and what each deployment trusts.
- `shared/` is what the app and the API both read (regions, #274), since neither may import the
  other; each side keeps its own logic (`api/_regions.ts`, `src/lib/regions.ts`).
- Every API response carries a `Server-Timing` header (`api/_serverTiming.ts`): read it in the
  browser's network panel when something is slow.

## Traps that cross files

- **Handlers are Node-style `(req, res)`**: a Web API style handler hangs in `vercel dev`.
- **Multi-write database paths are one batch**: a test asserts a single
  `db().batch(stmts, 'write')` (as for `transitionToPast`, `createTrip`, `patchTrip`).
- **A new cover-photo host goes in two places**: `vercel.json`'s `images.remotePatterns` and
  `CDN_HOSTS` (`src/lib/imageCdn.ts`, a test holds them equal); a photo on any other host skips
  the image CDN and loads from its own URL.
- **Owner emails are set twice**: `VITE_OWNER_EMAILS` (the UI hint) and `OWNER_EMAILS` (the
  server's gate). If they drift, owner UI shows but its calls fail.
- **Sign-in shows only in builds Vercel makes** (`SIGN_IN_ENABLED`: production, previews,
  `vercel dev`), so the visual tests, PR GIFs and README screenshots show the signed-out app;
  owner and signed-in views are reached through the test-only `window.__TEST_FORCE_OWNER__`
  (`src/lib/useOwner.ts`) and `__TEST_FORCE_EMAIL__` (`src/lib/authShim.ts`), which the `signIn`
  helper in `tests/visual/helpers.ts` sets.
- **The auth tables are the app's**: Better Auth's (`auth_*`) are created with the app's
  (`SCHEMA` in `api/_trips.ts`, its own startup check off), and a test fails when what it writes
  outgrows them. Roles and names stay in the app's `users` table.
- **No `legacy-peer-deps`**: installs are plain `npm ci`. A peer conflict (or an advisory with no
  upstream fix) takes a version bump or a narrow `overrides` entry, with its reason and when to
  delete it in `package.json`'s `//overrides`.
- **Tests are pure**: logic or React Testing Library, with no real network, database or browser;
  the browser is the visual tests' (`tests/visual/`).

## The auth model

**The server is the gate.** `requireOwnerCtx` (`api/_gqlContext.ts`) guards every owner-only write
and paid call (Gemini, apart from the capped drafts below); `requireMemberCtx` and
`requireCreatorCtx` guard trip-scoped actions; `requireUserCtx` admits any signed-in account only
where something else authorizes the action (`claimInvite`, whose invite token does) or where a
decision below says so. `useOwner()` (`src/lib/useOwner.ts`) is a UI hint only. A new public
external call, or a new `requireUserCtx` use, needs its own decision recorded here.

- **Sign-in** (`api/_betterAuth.ts`, at `/api/auth/*` ahead of `express.json()`): Google or
  Apple, then passkeys added from the account menu, which also connects the other providers to the
  signed-in account whatever their email (`allowDifferentEmails`), so an Apple ID behind Apple's
  relay joins an owner's or invitee's real-email account. A provider not yet connected joins an
  account only on the same verified email; until then a relay-hidden Apple account isn't an owner
  or an invitee. The session is an HttpOnly cookie on the site's own origin, each deployment bound
  to its origin (a preview to its branch address). Google One Tap is production's alone, on its own
  Google client.
- **Previews hold nothing that makes a session on the real site.** A preview builds any PR's
  code, Dependabot's included, and signs in through production's OAuth proxy, so production
  refuses the proxy's completion routes (`refusedRoute`, matching Better Auth's route, not the raw
  path), takes no Google or Apple ID token at `/sign-in/social` (`disableIdTokenSignIn`), keeps
  `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_SECRET` and Apple's key to itself, and trusts no preview
  origin; a preview trusts its own two addresses, never a `vercel.app` wildcard. A leaked proxy
  secret still gives away the provider profile (name, email, picture, its tokens) of someone
  finishing a sign-in production started, never a session.
- **Names come from the provider**: Google's given name at each sign-in, or the first word of
  Apple's at the first; `/update-user` is refused, so no one renames themselves in attributions.
- **Public by decision: `drivingMiles`** (#66) calls OpenRouteService for every visitor, a free
  service capped by a Turso-counted hourly budget (`ors_usage`: 20 uncached lookups, of which
  signed-out callers may use 12, West Coast origins only); over it the client shows the "≈"
  straight-line estimate.
- **Owner photos** (#19) are owner-only both ways, in a private Vercel Blob store the bytes reach
  without passing through the function (a ten-minute client token per JPEG, signed links that
  expire within the hour), at most 20 per activity to stay inside the Hobby limits (exceeding them
  pauses Blob for 30 days).
- **Contributors** (#9), who added each activity, go to signed-in accounts only: the field
  resolver in `api/_resolvers/catalog.ts` returns null to a signed-out caller, so the public
  catalog never says who added what. People show by first name (`users.display_name`), or by email
  without one or when it's shared; reviews carry their author's name for everyone, since reviews
  are public.
- **Suggestions and capped drafts** (#73): any signed-in account may suggest an activity (at most
  10 waiting at once), kept in `suggestions`, which the catalog read never touches, until an owner
  accepts (crediting the suggester) or rejects it. A suggestion keeps only http(s) links
  (`keepSavableLinks`) and no park (`parentId`): only owners choose what a park holds. A
  non-owner's Gemini draft (`generateActivity`) is capped in Turso (`api/_assistBudget.ts`: 5 per
  account, 30 in all per UTC day, owners uncounted), with bounded input (200 and 2,000 characters,
  five links), refused with `assist_limit` before Gemini is reached. A draft Gemini never answered
  is given back (`releaseAssist`); one it answered stays counted, since it was billed. Its AllTrails
  search (`api/_allTrailsSearch.ts`) keeps only a trail page one of its searches returned. A draft
  isn't required, and the client holds back a suggestion missing any field an owner would need,
  since owners can't edit one before accepting it. Every other Gemini call stays owner-only.
- **Sharing from Instagram** (#6) is owner-only (`findSharedPlaces`), as reading a post is a paid
  Gemini call; the post's text is a stranger's, so Gemini gets Google Search but not URL reading.
  `api/_instagram.ts` says what it reads and its limits, and never throws.

## Role-gated UI: hide, never grey out

- **An owner-gated write is not rendered for non-owners** (#67): gate the JSX on `isOwner`, never
  `disabled={!isOwner}` or a "Sign in to edit" tooltip. A greyed-out owner control is a bug.
  Default (non-owner) visual snapshots show owner controls absent.
- **Reads stay visible**; only the write inside one is hidden (`ActivityDetail`'s completion
  status is a badge for non-owners, the toggle owner-only).
- **Owner-only reads are recorded decisions**: Explore (#111: its tab hidden, and `OwnerRoute`
  waits for auth then sends non-owners to `/`); the Your Photos gallery (#19, the server read
  owner-gated too); the review queue (#73: `pendingSuggestions` asked for only by owners, the
  section shown only while something waits, its count a Review button in the toolbar and the
  mobile map's sheet, #259); and `/share` (#6), which sends a signed-in non-owner home and asks a
  signed-out visitor to sign in, since an owner opening a share from the iPhone Shortcut may not be
  signed in yet in Safari.
- **Sign-in-gated actions hide the same way** (#112) from signed-out visitors: "Select for trip"
  and "Add to trip" (a member power, #51; the per-card one only while building a trip), and
  Suggest activity (#73), where owners see Add activity. The Contributors filter (#9) isn't
  rendered for them, and a shared `?contributors=` link is ignored rather than emptying their list.
- **Trip-creator controls** in `TripDetail` (reopen or finalize voting, mark past, delete the trip,
  remove a member) are gated on this trip's creator, a per-trip role, and keep their presentation
  for the members who see them.
- Hiding a control never replaces the server's gate.
