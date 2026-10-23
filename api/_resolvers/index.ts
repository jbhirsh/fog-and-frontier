import { scalarResolvers } from './scalars.js';
import { activityFields, catalogMutation, catalogQuery } from './catalog.js';
import { drivingQuery } from './driving.js';
import { geminiMutation, geminiQuery } from './gemini.js';
import { tripsMutation, tripsQuery } from './trips.js';
import { tripActivitiesMutation } from './tripActivities.js';
import { votingMutation } from './voting.js';
import { membershipMutation, membershipQuery } from './membership.js';
import { reviewsMutation, reviewsQuery } from './reviews.js';
import { photosMutation, photosQuery } from './photos.js';
import { suggestionsMutation, suggestionsQuery } from './suggestions.js';
import { shareMutation } from './share.js';

// Single resolver map implementing api/_schema.ts. Scalars + Query + Mutation
// are assembled from the per-domain resolver modules. Other types use
// graphql's default field resolvers — the camelCase mapping happens in
// api/_gqlMap.ts at the resolver boundary — except the activity fields that
// depend on who is asking (contributors, #9).
export const resolvers = {
  ...scalarResolvers,
  Activity: activityFields,
  ActivitySnapshot: activityFields,
  Query: {
    ...catalogQuery,
    ...drivingQuery,
    ...reviewsQuery,
    ...photosQuery,
    ...suggestionsQuery,
    ...tripsQuery,
    ...membershipQuery,
    ...geminiQuery,
  },
  Mutation: {
    ...catalogMutation,
    ...reviewsMutation,
    ...photosMutation,
    ...suggestionsMutation,
    ...geminiMutation,
    ...shareMutation,
    ...tripsMutation,
    ...tripActivitiesMutation,
    ...votingMutation,
    ...membershipMutation,
  },
};
