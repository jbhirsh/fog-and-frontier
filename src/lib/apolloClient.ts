import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';

// The consolidated GraphQL endpoint (issue #91). Single function, single
// round-trip; replaces the 11 REST handlers under /api.
//
// Asks for plain JSON. Apollo Client's default `accept` puts
// application/graphql-response+json first, which Apollo Server then answers
// with, and Vercel's edge doesn't compress that type: the catalog crossed the
// wire at 650 KB rather than 157 KB of brotli.
//
// No Authorization header: the session is a cookie on this origin (sign-in,
// api/_betterAuth.ts), which the browser sends with every same-origin
// request (`credentials: 'same-origin'`), so a read never waits for the
// session to load.
const httpLink = new HttpLink({
  uri: '/api/graphql',
  credentials: 'same-origin',
  headers: { accept: 'application/json' },
});

// Normalized cache. keyFields per the migration plan (decision #8):
//   • Trip / TripActivity / Activity   → global identity by `id`
//   • User                             → global identity by `email`
//   • ActivityReview                   → identity by (activityId, authorEmail)
//   • TripMember / TripInvite / TripVote / ActivitySnapshot → embedded
//     (keyFields:false) — per-trip sub-objects with no independent identity,
//     which avoids the cross-trip collisions (N1) and the catalog-vs-snapshot
//     collision (N2).
// CompletedEntry / TripListItem keep the default id-based normalization.
// Factory so tests can spin up an isolated cache with identical policies.
export function createApolloCache(): InMemoryCache {
  return new InMemoryCache({
    typePolicies: {
      Trip: { keyFields: ['id'] },
      TripActivity: { keyFields: ['id'] },
      Activity: { keyFields: ['id'] },
      User: { keyFields: ['email'] },
      // Owner reviews (#184) have no `id`; identity is the (activity, author)
      // pair, which is also the DB primary key.
      ActivityReview: { keyFields: ['activityId', 'authorEmail'] },
      TripMember: { keyFields: false },
      TripInvite: { keyFields: false },
      TripVote: { keyFields: false },
      ActivitySnapshot: { keyFields: false },
    },
  });
}

export const apolloCache = createApolloCache();

export const apolloClient = new ApolloClient({
  link: httpLink,
  cache: apolloCache,
});
