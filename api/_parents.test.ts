import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./_db.js', () => ({ db: () => ({ execute }) }));

const {
  PARENT_RADIUS_METERS,
  checkParent,
  hasSubItems,
  matchParent,
  parentIdOf,
  parkName,
  parkNames,
  releaseSubItems,
} = await import('./_parents.js');

type Q = { sql: string; args: unknown[] };

/** A catalog of id → stored JSON, answering the two reads checkParent makes. */
function catalog(rows: Record<string, Record<string, unknown>>) {
  execute.mockImplementation(({ sql, args }: Q) => {
    if (sql === 'SELECT j FROM a WHERE id = ?') {
      const row = rows[args[0] as string];
      return Promise.resolve({ rows: row ? [{ j: JSON.stringify(row) }] : [] });
    }
    if (sql === "SELECT 1 FROM a WHERE json_extract(j, '$.parentId') = ? LIMIT 1") {
      const any = Object.values(rows).some((r) => r.parentId === args[0]);
      return Promise.resolve({ rows: any ? [{ 1: 1 }] : [] });
    }
    return Promise.reject(new Error(`unexpected ${sql}`));
  });
}

beforeEach(() => {
  execute.mockReset();
});

describe('parentIdOf', () => {
  it('reads the parent a stored activity names', () => {
    expect(parentIdOf(JSON.stringify({ id: 'chimney-rock', parentId: 'point-reyes' }))).toBe(
      'point-reyes',
    );
  });

  it('is null for none, or anything that isn’t a stored activity naming one', () => {
    for (const j of [
      JSON.stringify({ id: 'point-reyes' }),
      JSON.stringify({ parentId: '' }),
      JSON.stringify({ parentId: 7 }),
      JSON.stringify(null),
      '{not json',
      undefined,
      42,
    ]) {
      expect(parentIdOf(j), String(j)).toBeNull();
    }
  });
});

describe('hasSubItems', () => {
  it('asks whether any activity names it, and says so', async () => {
    catalog({ 'chimney-rock': { parentId: 'point-reyes' } });
    expect(await hasSubItems('point-reyes')).toBe(true);
    expect(await hasSubItems('chimney-rock')).toBe(false);
    expect(execute).toHaveBeenCalledWith({
      sql: "SELECT 1 FROM a WHERE json_extract(j, '$.parentId') = ? LIMIT 1",
      args: ['point-reyes'],
    });
  });
});

describe('checkParent', () => {
  const ROWS = {
    'point-reyes': { name: 'Point Reyes National Seashore' },
    'chimney-rock': { name: 'Chimney Rock Trail', parentId: 'point-reyes' },
    'muir-woods': { name: 'Muir Woods' },
  };

  it('lets a park be the parent of an activity, new or saved', async () => {
    catalog(ROWS);
    await expect(checkParent(null, 'point-reyes')).resolves.toBeUndefined();
    await expect(checkParent('muir-woods', 'point-reyes')).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith({
      sql: 'SELECT j FROM a WHERE id = ?',
      args: ['point-reyes'],
    });
  });

  it('asks nothing when there’s no parent', async () => {
    catalog(ROWS);
    await expect(checkParent('chimney-rock', null)).resolves.toBeUndefined();
    await expect(checkParent('chimney-rock', undefined)).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('turns down a parent that isn’t an id', async () => {
    catalog(ROWS);
    for (const parentId of ['', 7, { id: 'point-reyes' }]) {
      await expect(checkParent('muir-woods', parentId)).rejects.toThrow(
        'parentId must be an activity id',
      );
    }
  });

  it('turns down the activity itself', async () => {
    catalog(ROWS);
    await expect(checkParent('point-reyes', 'point-reyes')).rejects.toThrow(
      "an activity can't be part of itself",
    );
  });

  it('turns down a parent that isn’t saved', async () => {
    catalog(ROWS);
    await expect(checkParent('muir-woods', 'yosemite')).rejects.toThrow(
      "parentId doesn't name a saved activity",
    );
  });

  it('turns down a parent that is part of another (one level only)', async () => {
    catalog(ROWS);
    await expect(checkParent('muir-woods', 'chimney-rock')).rejects.toThrow(
      'that activity is part of another; pick the one it belongs to',
    );
  });

  it('turns down a parent for an activity with sub-items of its own', async () => {
    catalog({ ...ROWS, yosemite: { name: 'Yosemite' } });
    await expect(checkParent('point-reyes', 'yosemite')).rejects.toThrow(
      'this activity has hikes and stops of its own, so it can’t be part of another',
    );
  });

  it('turns them all down as bad input', async () => {
    catalog(ROWS);
    await expect(checkParent('point-reyes', 'point-reyes')).rejects.toMatchObject({
      extensions: { code: 'BAD_USER_INPUT' },
    });
  });
});

describe('releaseSubItems', () => {
  it('clears the link on every activity naming it', () => {
    expect(releaseSubItems('point-reyes')).toEqual({
      sql: "UPDATE a SET j = json_remove(j, '$.parentId') WHERE json_extract(j, '$.parentId') = ?",
      args: ['point-reyes'],
    });
  });
});

describe('matchParent', () => {
  const POINT_REYES = {
    id: 'point-reyes-seashore',
    name: 'Point Reyes National Seashore',
    lat: 38.0405,
    lng: -122.7993,
  };
  const YOSEMITE = {
    id: 'yosemite-national-park',
    name: 'Yosemite National Park',
    lat: 37.7489,
    lng: -119.5885,
  };
  const CHIMNEY = { name: 'Chimney Rock Trail', lat: 37.9944, lng: -122.9662 };

  it('matches the saved park Gemini named', () => {
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [YOSEMITE, POINT_REYES]),
    ).toBe('point-reyes-seashore');
  });

  it('matches whichever place of a list is the saved park, in either order', () => {
    const GGNRA = {
      id: 'ggnra',
      name: 'Golden Gate National Recreation Area',
      lat: 37.8,
      lng: -122.47,
    };
    const ride = { name: 'Presidio bike ride', lat: 37.7989, lng: -122.4662 };
    for (const partOf of [
      'Golden Gate National Recreation Area, Presidio of San Francisco',
      'Presidio of San Francisco, Golden Gate National Recreation Area',
    ]) {
      expect(matchParent({ ...ride, partOf }, [GGNRA]), partOf).toBe('ggnra');
    }
    // A listed place that is the draft itself is set aside, not taken as
    // the draft being the park.
    expect(
      matchParent(
        {
          ...ride,
          name: 'Presidio of San Francisco',
          partOf: 'Presidio of San Francisco, Golden Gate National Recreation Area',
        },
        [GGNRA],
      ),
    ).toBe('ggnra');
    // Naming only itself, the draft is the park: no parent.
    expect(
      matchParent(
        {
          ...ride,
          name: 'Golden Gate National Recreation Area',
          partOf: 'Golden Gate National Recreation Area',
        },
        [GGNRA],
      ),
    ).toBeNull();
  });

  it('matches a saved name of two words or more that Gemini’s holds whole', () => {
    const MUIR = { id: 'muir-woods', name: 'Muir Woods', lat: 37.8912, lng: -122.5719 };
    const hike = { name: 'Ben Johnson Trail', lat: 37.8957, lng: -122.5788 };
    // 2 of 4 words is only 0.5, but every word of the saved name is there.
    expect(matchParent({ ...hike, partOf: 'Muir Woods National Monument' }, [MUIR])).toBe(
      'muir-woods',
    );
    // One word held isn't enough: "Muir" alone could be anything.
    expect(
      matchParent({ ...hike, partOf: 'Muir Woods National Monument' }, [{ ...MUIR, name: 'Muir' }]),
    ).toBeNull();
    // Nor is most of a saved name.
    expect(
      matchParent({ ...hike, partOf: 'Muir Grove' }, [{ ...MUIR, name: 'Muir Woods Beach' }]),
    ).toBeNull();
    // A closer name still wins over one only held whole.
    const exact = { ...MUIR, id: 'monument', name: 'Muir Woods National Monument', lat: 37.9 };
    expect(matchParent({ ...hike, partOf: 'Muir Woods National Monument' }, [MUIR, exact])).toBe(
      'monument',
    );
  });

  it('matches the name however it’s written', () => {
    // Case, punctuation and "the"/"of" don't count.
    expect(
      matchParent({ ...CHIMNEY, partOf: 'the point-reyes national seashore' }, [POINT_REYES]),
    ).toBe('point-reyes-seashore');
    // Most of the words: 3 of 4 shared is 0.75.
    expect(matchParent({ ...CHIMNEY, partOf: 'Point Reyes Seashore' }, [POINT_REYES])).toBe(
      'point-reyes-seashore',
    );
  });

  it('turns down a name with too few words in common', () => {
    // 2 of 4 shared: half isn't enough.
    expect(matchParent({ ...CHIMNEY, partOf: 'Point Reyes' }, [POINT_REYES])).toBeNull();
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Golden Gate National Recreation Area' }, [POINT_REYES]),
    ).toBeNull();
  });

  it('turns down a park of the same name too far away to be it', () => {
    const elsewhere = { ...POINT_REYES, id: 'elsewhere', lat: POINT_REYES.lat + 1.2 }; // ~133 km north
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [elsewhere]),
    ).toBeNull();
    const justInReach = { ...POINT_REYES, id: 'in-reach', lat: CHIMNEY.lat + 1.07 }; // ~119 km north
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [justInReach]),
    ).toBe('in-reach');
    expect(PARENT_RADIUS_METERS).toBe(120_000);
  });

  it('never matches an activity that is itself part of another', () => {
    const nested = { ...POINT_REYES, parentId: 'marin' };
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [nested]),
    ).toBeNull();
  });

  it('gives a park drafted as itself no parent, and never matches a place of the draft’s own name', () => {
    const park = { name: 'Point Reyes National Seashore', lat: 38.04, lng: -122.8 };
    expect(
      matchParent({ ...park, partOf: 'Point Reyes National Seashore' }, [POINT_REYES]),
    ).toBeNull();
    // A draft named like a saved place, part of a park with a similar name.
    const lookalike = {
      id: 'pr-seashore-trail',
      name: 'Point Reyes Seashore',
      lat: 38.0,
      lng: -122.9,
    };
    expect(
      matchParent(
        {
          name: 'Point Reyes Seashore',
          lat: 38.0,
          lng: -122.9,
          partOf: 'Point Reyes National Seashore',
        },
        [lookalike, POINT_REYES],
      ),
    ).toBe('point-reyes-seashore');
  });

  it('prefers the closest name, then the nearest park', () => {
    const fuzzy = { id: 'fuzzy', name: 'Point Reyes Seashore', lat: CHIMNEY.lat, lng: CHIMNEY.lng };
    const exactButFar = { ...POINT_REYES, id: 'exact', lat: CHIMNEY.lat + 0.5 };
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [fuzzy, exactButFar]),
    ).toBe('exact');
    const near = { ...POINT_REYES, id: 'near', lat: CHIMNEY.lat + 0.1 };
    const far = { ...POINT_REYES, id: 'far', lat: CHIMNEY.lat + 0.5 };
    expect(matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [far, near])).toBe(
      'near',
    );
    expect(matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [near, far])).toBe(
      'near',
    );
  });

  it('matches a name sharing exactly enough words, and none sharing fewer', () => {
    // 3 shared of 5 in all is 0.6, just enough.
    const park = { ...POINT_REYES, id: 'park', name: 'Point Reyes National Park' };
    expect(matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [park])).toBe(
      'park',
    );
  });

  it('gives a park drafted as itself no parent, even one with a near name saved', () => {
    const near = { id: 'near', name: 'Point Reyes Seashore', lat: 38.04, lng: -122.8 };
    const park = { name: 'Point Reyes National Seashore', lat: 38.04, lng: -122.8 };
    expect(matchParent({ ...park, partOf: 'Point Reyes National Seashore' }, [near])).toBeNull();
  });

  it('never matches a saved place of the draft’s own name', () => {
    const same = { id: 'same', name: 'Point Reyes Seashore', lat: 38.0, lng: -122.9 };
    expect(
      matchParent(
        {
          name: 'Point Reyes Seashore',
          lat: 38.0,
          lng: -122.9,
          partOf: 'Point Reyes National Seashore',
        },
        [same],
      ),
    ).toBeNull();
  });

  it('keeps the closest name over a nearer park, whichever comes first', () => {
    const fuzzy = { id: 'fuzzy', name: 'Point Reyes Seashore', lat: CHIMNEY.lat, lng: CHIMNEY.lng };
    const exactButFar = { ...POINT_REYES, id: 'exact', lat: CHIMNEY.lat + 0.5 };
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [exactButFar, fuzzy]),
    ).toBe('exact');
  });

  it('keeps the first of two parks equally near and equally named', () => {
    const first = { ...POINT_REYES, id: 'first' };
    const second = { ...POINT_REYES, id: 'second' };
    expect(
      matchParent({ ...CHIMNEY, partOf: 'Point Reyes National Seashore' }, [first, second]),
    ).toBe('first');
  });

  it('matches nothing without a park name, unless the draft’s own name holds one', () => {
    for (const partOf of [undefined, null, 7, '', '   ']) {
      expect(matchParent({ ...CHIMNEY, partOf }, [POINT_REYES]), String(partOf)).toBeNull();
    }
  });

  it('matches a saved park the draft’s own name holds whole, when Gemini named none', () => {
    const CASTLE_ROCK = {
      id: 'castle-rock',
      name: 'Castle Rock State Park',
      lat: 37.2306,
      lng: -122.0957,
    };
    const bouldering = { name: 'Bouldering at Castle Rock State Park', lat: 37.2318, lng: -122.1 };
    expect(matchParent(bouldering, [POINT_REYES, CASTLE_ROCK])).toBe('castle-rock');
    // Only held whole: most of its words isn't enough without a name from Gemini.
    expect(matchParent({ ...bouldering, name: 'Castle Rock State' }, [CASTLE_ROCK])).toBeNull();
    expect(
      matchParent({ ...bouldering, name: 'Bouldering at Castle Rock State' }, [CASTLE_ROCK]),
    ).toBeNull();
    expect(
      matchParent({ ...bouldering, name: 'Bouldering at Castle Rock' }, [CASTLE_ROCK]),
    ).toBeNull();
    // Nor one word.
    expect(
      matchParent({ ...bouldering, name: 'Castle bouldering' }, [
        { ...CASTLE_ROCK, name: 'Castle' },
      ]),
    ).toBeNull();
    // Nor a park too far away to be it.
    expect(matchParent({ ...bouldering, lat: 40.5 }, [CASTLE_ROCK])).toBeNull();
    // Only a park the name places it in, not one it merely holds.
    const MUIR = { id: 'muir-woods', name: 'Muir Woods', lat: 37.8912, lng: -122.5719 };
    const near = { lat: 37.89, lng: -122.57 };
    for (const name of [
      'Muir Woods Trading Company',
      'Muir Woods National Monument',
      'Muir Woods',
      'Lunch near Muir Woods',
    ]) {
      expect(matchParent({ ...near, name }, [MUIR]), name).toBeNull();
    }
    for (const name of [
      'Redwood loop in Muir Woods',
      'Cathedral Grove at the Muir Woods',
      'Fern Creek inside Muir Woods National Monument',
      'Bohemian Grove within Muir Woods',
      'Trees OF MUIR WOODS',
    ]) {
      expect(matchParent({ ...near, name }, [MUIR]), name).toBe('muir-woods');
    }
    // The park itself, drafted, is still no part of itself.
    expect(
      matchParent({ ...bouldering, name: 'Castle Rock State Park' }, [CASTLE_ROCK]),
    ).toBeNull();
  });

  it('matches the park Gemini named even when its answer ran on past the name', () => {
    expect(
      matchParent(
        {
          ...CHIMNEY,
          partOf: 'Point Reyes National Seashore   allTrailsUrl: "https://www.alltrails.com/x',
        },
        [POINT_REYES],
      ),
    ).toBe('point-reyes-seashore');
  });
});

describe('parkName', () => {
  it('keeps the name Gemini gave, trimmed', () => {
    expect(parkName('  Point Reyes National Seashore ')).toBe('Point Reyes National Seashore');
    expect(parkName("Fushimi Inari-taisha's grounds")).toBe("Fushimi Inari-taisha's grounds");
  });

  it('cuts an answer that ran on past the name', () => {
    for (const ran of [
      'Point Reyes National Seashore   allTrailsUrl: "https://www.alltrails.com/x", notes: "No dogs"',
      'Point Reyes National Seashore allTrailsUrl: https://www.alltrails.com/x',
      'Point Reyes National Seashore", "notes": "No dogs',
      'Point Reyes National Seashore "notes',
      'Point Reyes National Seashore\nnotes: No dogs',
      'Point Reyes National Seashore\tx',
      'Point Reyes National Seashore\r\n',
    ]) {
      expect(parkName(ran), ran).toBe('Point Reyes National Seashore');
    }
  });

  it('takes a name Gemini quoted', () => {
    expect(parkName('"Point Reyes National Seashore"')).toBe('Point Reyes National Seashore');
    expect(parkName('“Point Reyes National Seashore”')).toBe('Point Reyes National Seashore');
    expect(parkName('‘Muir Woods’ ')).toBe('Muir Woods');
    expect(parkName("'Muir Woods'")).toBe('Muir Woods');
    // An apostrophe of the name's own stays.
    expect(parkName("Fushimi Inari-taisha's grounds")).toBe("Fushimi Inari-taisha's grounds");
  });

  it('keeps the first of a list of parks', () => {
    for (const [list, first] of [
      [
        'Golden Gate National Recreation Area, Presidio of San Francisco',
        'Golden Gate National Recreation Area',
      ],
      ['Point Reyes National Seashore; Phillip Burton Wilderness', 'Point Reyes National Seashore'],
      ['"Yosemite National Park", Stanislaus National Forest', 'Yosemite National Park'],
      ['Big Basin Redwoods State Park,', 'Big Basin Redwoods State Park'],
    ]) {
      expect(parkName(list), list).toBe(first);
    }
    // Empty places in a list are skipped; nothing at all is no park.
    expect(parkName(', Presidio of San Francisco')).toBe('Presidio of San Francisco');
    expect(parkName(' , ; ')).toBeNull();
  });

  it('lists every place named, in order, for matching', () => {
    expect(parkNames(' Presidio of San Francisco , Golden Gate National Recreation Area;')).toEqual(
      ['Presidio of San Francisco', 'Golden Gate National Recreation Area'],
    );
    // A closing quote still ends the answer, list and all.
    expect(parkNames('"Presidio of San Francisco", Golden Gate')).toEqual([
      'Presidio of San Francisco',
    ]);
    expect(parkNames('Point Reyes National Seashore')).toEqual(['Point Reyes National Seashore']);
    expect(parkNames(null)).toEqual([]);
    expect(parkNames('')).toEqual([]);
  });

  it('keeps a comma inside the name’s own brackets', () => {
    for (const name of [
      'Golden Gate National Recreation Area (Marin Headlands, Fort Baker)',
      'Point Reyes [Drakes Estero, Limantour] National Seashore',
    ]) {
      expect(parkName(name), name).toBe(name);
    }
    // A comma after the brackets close still ends the name.
    expect(parkName('Lake Tahoe (Nevada side), Sand Harbor')).toBe('Lake Tahoe (Nevada side)');
    // A stray closing bracket doesn't hide a comma after it.
    expect(parkName('Muir Woods), Mount Tamalpais')).toBe('Muir Woods)');
  });

  it('keeps a colon of the name’s own', () => {
    for (const name of [
      'Santa Cruz Mountains: Big Basin Redwoods State Park',
      'Lake Tahoe Basin: Desolation Wilderness',
      'Muir Woods: A National Monument',
    ]) {
      expect(parkName(name), name).toBe(name);
    }
    // Only the draft's own fields end it.
    expect(parkName('Point Reyes National Seashore notes: No dogs')).toBe(
      'Point Reyes National Seashore',
    );
    expect(parkName('Point Reyes National Seashore partOf : x')).toBe(
      'Point Reyes National Seashore',
    );
  });

  it('gives nothing for a non-name', () => {
    for (const value of [undefined, null, 7, '', '   ', '""', '" "']) {
      expect(parkName(value), String(value)).toBeNull();
    }
  });
});
