import { apolloClient } from './apolloClient';
import { ALLTRAILS_LOOKUP } from './gqlDocs';

export type AllTrailsLookup = {
  allTrailsRating?: number;
  hikeDistanceMiles?: number;
  hikeElevationFeet?: number;
};

// Fetches rating + distance + elevation for a given AllTrails URL via the
// owner-gated alltrailsLookup mutation. Auth is injected by the Apollo link.
export async function lookupAllTrails(url: string): Promise<AllTrailsLookup> {
  const { data } = await apolloClient.mutate({
    mutation: ALLTRAILS_LOOKUP,
    variables: { input: { url } },
  });
  const lookup = data?.alltrailsLookup.lookup;
  return {
    allTrailsRating: lookup?.allTrailsRating ?? undefined,
    hikeDistanceMiles: lookup?.hikeDistanceMiles ?? undefined,
    hikeElevationFeet: lookup?.hikeElevationFeet ?? undefined,
  };
}
