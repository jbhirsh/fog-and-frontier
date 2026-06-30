import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client';
import { SetContextLink } from '@apollo/client/link/context';

// The consolidated GraphQL endpoint (issue #91). Single function, single
// round-trip; replaces the 11 REST handlers under /api.
const httpLink = new HttpLink({ uri: '/api/graphql' });

// Module-level token getter. Links run outside React, so they can't call
// Clerk hooks directly — the auth bridge component (ClerkAuthProvider)
// registers the live `getToken` here via setAuthTokenGetter. Defaults to the
// anonymous (no-token) getter so the public-only / no-Clerk path Just Works.
let tokenGetter: () => Promise<string | null> = () => Promise.resolve(null);

export function setAuthTokenGetter(
  getter: () => Promise<string | null>,
): void {
  tokenGetter = getter;
}

// AC4 SetContextLink: injects `Authorization: Bearer <token>` per request,
// reading the current token from the module-level getter at request time.
const authLink = new SetContextLink(async (prevContext) => {
  const token = await tokenGetter();
  const prevHeaders = (prevContext.headers ?? {}) as Record<string, string>;
  return {
    headers: {
      ...prevHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
});

// Normalized cache. keyFields per the migration plan (decision #8):
//   • Trip / TripActivity / Activity   → global identity by `id`
//   • User                             → global identity by `email`
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
      TripMember: { keyFields: false },
      TripInvite: { keyFields: false },
      TripVote: { keyFields: false },
      ActivitySnapshot: { keyFields: false },
    },
  });
}

export const apolloCache = createApolloCache();

export const apolloClient = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: apolloCache,
});
