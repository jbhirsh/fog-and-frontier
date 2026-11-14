import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloClient } from './apolloClient';
import { generateActivity } from './generateActivity';
import { GENERATE_ACTIVITY } from './gqlDocs';

// The draft as the server returns it: every optional field null.
function bareRow(over: Record<string, unknown> = {}) {
  return {
    name: 'Tennessee Valley',
    shortDescription: 'An easy walk to a cove',
    longDescription: null,
    cardLine: null,
    cardName: null,
    category: 'hiking',
    region: null,
    parkType: null,
    city: 'Mill Valley',
    lat: 37.86,
    lng: -122.53,
    duration: '2-3 Hours',
    durationDetail: null,
    difficulty: null,
    dogFriendly: null,
    dogRulesUrl: null,
    hikeDistanceMiles: null,
    hikeElevationFeet: null,
    cuisine: null,
    priceRange: null,
    costTier: null,
    hours: null,
    reservationUrl: null,
    menuUrl: null,
    dietary: null,
    allTrailsUrl: null,
    allTrailsOptions: null,
    notes: null,
    coverImage: null,
    coverCredit: null,
    parentId: null,
    ...over,
  };
}

function stubActivity(activity: unknown) {
  return vi
    .spyOn(apolloClient, 'mutate')
    .mockResolvedValue({ data: { generateActivity: { activity } } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateActivity', () => {
  it('sends the title and notes through the generateActivity mutation', async () => {
    const mutate = stubActivity(bareRow());
    await generateActivity('Tennessee Valley', 'the beach at the end');
    expect(mutate).toHaveBeenCalledWith({
      mutation: GENERATE_ACTIVITY,
      variables: { input: { title: 'Tennessee Valley', notes: 'the beach at the end' } },
    });
  });

  it('maps a full draft, its trail options included', async () => {
    stubActivity(
      bareRow({
        longDescription: 'Long',
        cardLine: 'A cove walk',
        cardName: 'Tennessee',
        region: 'marin',
        parkType: 'national',
        difficulty: 'easy',
        hikeDistanceMiles: 3.4,
        coverImage: 'https://img/cover.jpg',
        parentId: 'golden-gate',
        allTrailsOptions: [
          {
            url: 'https://www.alltrails.com/trail/a',
            title: 'Trail A',
            description: 'Out and back',
            image: 'https://img/a.jpg',
            rating: 4.6,
            reviews: 900,
            miles: 3.4,
            feet: 300,
          },
          {
            url: 'https://www.alltrails.com/trail/b',
            title: 'Trail B',
            description: 'Loop',
            image: null,
            rating: null,
            reviews: null,
            miles: null,
            feet: null,
          },
        ],
      }),
    );

    expect(await generateActivity('t', 'n')).toStrictEqual({
      name: 'Tennessee Valley',
      shortDescription: 'An easy walk to a cove',
      longDescription: 'Long',
      cardLine: 'A cove walk',
      cardName: 'Tennessee',
      category: 'hiking',
      region: 'marin',
      parkType: 'national',
      city: 'Mill Valley',
      lat: 37.86,
      lng: -122.53,
      duration: '2-3 Hours',
      durationDetail: undefined,
      difficulty: 'easy',
      dogFriendly: undefined,
      dogRulesUrl: undefined,
      hikeDistanceMiles: 3.4,
      hikeElevationFeet: undefined,
      allTrailsUrl: undefined,
      cuisine: undefined,
      priceRange: undefined,
      costTier: undefined,
      hours: undefined,
      reservationUrl: undefined,
      menuUrl: undefined,
      dietary: undefined,
      notes: undefined,
      coverCredit: undefined,
      coverImage: 'https://img/cover.jpg',
      parentId: 'golden-gate',
      allTrailsOptions: [
        {
          url: 'https://www.alltrails.com/trail/a',
          title: 'Trail A',
          description: 'Out and back',
          image: 'https://img/a.jpg',
          rating: 4.6,
          reviews: 900,
          miles: 3.4,
          feet: 300,
        },
        {
          url: 'https://www.alltrails.com/trail/b',
          title: 'Trail B',
          description: 'Loop',
          image: undefined,
          rating: undefined,
          reviews: undefined,
          miles: undefined,
          feet: undefined,
        },
      ],
    });
  });

  it('turns every missing optional field into undefined, so the form asks for it', async () => {
    stubActivity(bareRow());
    const draft = await generateActivity('t', 'n');
    expect(draft).toMatchObject({ name: 'Tennessee Valley', city: 'Mill Valley' });
    for (const key of [
      'longDescription',
      'cardLine',
      'cardName',
      'region',
      'parkType',
      'coverImage',
      'parentId',
      'allTrailsOptions',
    ] as const) {
      expect(draft).toHaveProperty(key, undefined);
    }
  });

  it('throws when the server generated nothing', async () => {
    stubActivity(null);
    await expect(generateActivity('t', 'n')).rejects.toThrow('No activity was generated');
  });

  it('throws when the mutation gave no data', async () => {
    vi.spyOn(apolloClient, 'mutate').mockResolvedValue({ data: undefined });
    await expect(generateActivity('t', 'n')).rejects.toThrow('No activity was generated');
  });
});
