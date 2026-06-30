import { scalarResolvers } from './scalars.js';
import { catalogMutation, catalogQuery } from './catalog.js';
import { geminiMutation, geminiQuery } from './gemini.js';
import { tripsMutation, tripsQuery } from './trips.js';
import { tripActivitiesMutation } from './tripActivities.js';
import { votingMutation } from './voting.js';
import { membershipMutation, membershipQuery } from './membership.js';

// Single resolver map implementing api/_schema.ts. Scalars + Query + Mutation
// are assembled from the per-domain resolver modules. Embedded types
// (ActivitySnapshot, TripMember, …) use graphql's default field resolvers — the
// camelCase mapping happens in api/_gqlMap.ts at the resolver boundary.
export const resolvers = {
  ...scalarResolvers,
  Query: {
    ...catalogQuery,
    ...tripsQuery,
    ...membershipQuery,
    ...geminiQuery,
  },
  Mutation: {
    ...catalogMutation,
    ...geminiMutation,
    ...tripsMutation,
    ...tripActivitiesMutation,
    ...votingMutation,
    ...membershipMutation,
  },
};
