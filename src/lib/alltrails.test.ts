import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloClient } from './apolloClient';
import { lookupAllTrails } from './alltrails';
import { ALLTRAILS_LOOKUP } from './gqlDocs';

function stubLookup(lookup: Record<string, number | null> | null) {
  return vi
    .spyOn(apolloClient, 'mutate')
    .mockResolvedValue({ data: { alltrailsLookup: { lookup } } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lookupAllTrails', () => {
  it('sends the URL through the alltrailsLookup mutation and returns its stats', async () => {
    const mutate = stubLookup({
      allTrailsRating: 4.7,
      hikeDistanceMiles: 5.2,
      hikeElevationFeet: 1200,
    });
    const url = 'https://www.alltrails.com/trail/us/california/dipsea-trail';

    expect(await lookupAllTrails(url)).toEqual({
      allTrailsRating: 4.7,
      hikeDistanceMiles: 5.2,
      hikeElevationFeet: 1200,
    });
    expect(mutate).toHaveBeenCalledWith({
      mutation: ALLTRAILS_LOOKUP,
      variables: { input: { url } },
    });
  });

  it('turns the stats the page lacked into undefined', async () => {
    stubLookup({ allTrailsRating: null, hikeDistanceMiles: 0, hikeElevationFeet: null });
    const result = await lookupAllTrails('https://www.alltrails.com/trail/x');
    expect(result).toStrictEqual({
      allTrailsRating: undefined,
      hikeDistanceMiles: 0,
      hikeElevationFeet: undefined,
    });
  });

  it('returns no stats when the server found nothing', async () => {
    stubLookup(null);
    expect(await lookupAllTrails('https://www.alltrails.com/trail/x')).toStrictEqual({
      allTrailsRating: undefined,
      hikeDistanceMiles: undefined,
      hikeElevationFeet: undefined,
    });
  });

  it('returns no stats when the mutation gave no data', async () => {
    vi.spyOn(apolloClient, 'mutate').mockResolvedValue({ data: undefined });
    expect(await lookupAllTrails('https://www.alltrails.com/trail/x')).toStrictEqual({
      allTrailsRating: undefined,
      hikeDistanceMiles: undefined,
      hikeElevationFeet: undefined,
    });
  });
});
