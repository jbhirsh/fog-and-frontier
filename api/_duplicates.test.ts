import { describe, expect, it } from 'vitest';
import {
  distanceMeters,
  findDuplicates,
  freeId,
  normalizeName,
  slugify,
  wordOverlap,
  type CatalogPlace,
} from './_duplicates.js';

// Castle Rock State Park's main lot; ~0.0045° of latitude is ~500 m.
const CASTLE = { lat: 37.2309, lng: -122.0961 };
const north = (meters: number) => ({ lat: CASTLE.lat + meters / 111_195, lng: CASTLE.lng });

function place(id: string, name: string, at = CASTLE, city = 'Los Gatos'): CatalogPlace {
  return { id, name, city, ...at };
}

describe('normalizeName', () => {
  it('lower-cases, drops accents and punctuation, collapses spaces', () => {
    expect(normalizeName("  Duarte's   Tavern — Pescadero! ")).toBe('duartes tavern pescadero');
    expect(normalizeName('Café Nído')).toBe('cafe nido');
  });

  it('reads apostrophes, "&", "the" and folded letters as the same name', () => {
    expect(normalizeName("Sam's Chowder House")).toBe(normalizeName('Sams Chowder House'));
    expect(normalizeName('Sam’s Chowder House')).toBe('sams chowder house');
    expect(normalizeName('The Slanted Door')).toBe(normalizeName('Slanted Door'));
    expect(normalizeName('Fish & Farm')).toBe(normalizeName('Fish and Farm'));
    expect(normalizeName('Fish & Farm')).toBe('fish farm');
    expect(normalizeName('Straße Café')).toBe('strasse cafe');
    expect(normalizeName('Æbleskiver Ølbar Łódź Œuvre Đà Þing')).toBe(
      'aebleskiver olbar lodz oeuvre da thing',
    );
  });

  it('has no words for a name with no Latin letters', () => {
    expect(normalizeName('東京')).toBe('');
  });
});

describe('wordOverlap', () => {
  it('is shared words over all words', () => {
    expect(wordOverlap(['castle', 'rock', 'state', 'park'], ['castle', 'rock', 'park'])).toBe(0.75);
    expect(wordOverlap(['castle', 'rock'], ['big', 'basin'])).toBe(0);
  });

  it('is 0 when there are no words to compare', () => {
    expect(wordOverlap([], [])).toBe(0);
  });
});

describe('distanceMeters', () => {
  it('measures great-circle metres', () => {
    expect(distanceMeters(CASTLE, CASTLE)).toBe(0);
    expect(distanceMeters(CASTLE, north(1000))).toBeCloseTo(1000, 0);
  });

  it('shrinks a degree of longitude with latitude', () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
    expect(distanceMeters({ lat: 60, lng: 0 }, { lat: 60, lng: 1 })).toBeCloseTo(55_597, -1);
    expect(distanceMeters({ lat: 37, lng: -122 }, { lat: 38, lng: -121 })).toBeCloseTo(141_936, -1);
  });
});

describe('findDuplicates (#17)', () => {
  it('rates the same name within 500 m as high', () => {
    const m = findDuplicates({ name: 'Castle Rock!', ...north(499) }, [place('cr', 'castle rock')]);
    expect(m).toEqual([
      { id: 'cr', name: 'castle rock', city: 'Los Gatos', distanceMeters: 499, confidence: 'high' },
    ]);
  });

  it('rates the same name farther away as possible, at any distance', () => {
    expect(
      findDuplicates({ name: 'Castle Rock', ...north(501) }, [place('cr', 'Castle Rock')])[0]
        .confidence,
    ).toBe('possible');
    expect(
      findDuplicates({ name: 'Castle Rock', lat: 45, lng: -122 }, [place('cr', 'Castle Rock')])[0]
        .confidence,
    ).toBe('possible');
  });

  it('rates 60% shared words within 2 km as possible, and not beyond', () => {
    const catalog = [place('cr', 'Castle Rock State Park')];
    expect(
      findDuplicates({ name: 'Castle Rock Park', ...north(1999) }, catalog)[0].confidence,
    ).toBe('possible');
    expect(findDuplicates({ name: 'Castle Rock Park', ...north(2001) }, catalog)).toEqual([]);
    // Exactly 60%: three of five words.
    expect(
      findDuplicates({ name: 'Castle Rock Lake', ...CASTLE }, [
        place('v', 'Castle Rock Lake View Peak'),
      ])[0].confidence,
    ).toBe('possible');
    // Under 60%: "castle rock falls trail" shares 2 of 6 words.
    expect(findDuplicates({ name: 'Castle Rock Falls Trail', ...CASTLE }, catalog)).toEqual([]);
  });

  it('finds nothing for a different place nearby', () => {
    expect(findDuplicates({ name: 'Big Basin', ...CASTLE }, [place('cr', 'Castle Rock')])).toEqual(
      [],
    );
  });

  it('never matches an empty name to another empty name', () => {
    expect(findDuplicates({ name: '!!', ...CASTLE }, [place('x', '??')])).toEqual([]);
  });

  it('lists high matches first, then the nearest', () => {
    const m = findDuplicates({ name: 'Castle Rock', ...CASTLE }, [
      place('far', 'Castle Rock', north(5000)),
      place('near', 'Castle Rock Park', north(100)),
      place('same', 'Castle Rock', north(300)),
    ]);
    expect(m.map((x) => [x.id, x.confidence])).toEqual([
      ['same', 'high'],
      ['near', 'possible'],
      ['far', 'possible'],
    ]);
  });

  it('ranks every high match above every possible one, whatever order they come in', () => {
    const m = findDuplicates({ name: 'Castle Rock', ...CASTLE }, [
      place('p1', 'Castle Rock Park', north(50)),
      place('h2', 'Castle Rock', north(400)),
      place('p2', 'Castle Rock Park', north(150)),
      place('h1', 'Castle Rock', north(200)),
    ]);
    expect(m.map((x) => x.id)).toEqual(['h1', 'h2', 'p1', 'p2']);
  });
});

describe('freeId (#17)', () => {
  it('keeps a free id, and steps past taken ones', async () => {
    const taken = new Set(['castle-rock', 'castle-rock-2']);
    const isTaken = (id: string) => Promise.resolve(taken.has(id));
    expect(await freeId('big-basin', isTaken)).toBe('big-basin');
    expect(await freeId('castle-rock', isTaken)).toBe('castle-rock-3');
  });
});

describe('slugify (#73)', () => {
  it('lower-cases and joins the words with single dashes, trimming the ends', () => {
    expect(slugify("  Sam's Chowder House! ")).toBe('sam-s-chowder-house');
    expect(slugify('--Fort   Funston--')).toBe('fort-funston');
  });

  it('keeps at most 48 characters', () => {
    expect(slugify('a'.repeat(60))).toBe('a'.repeat(48));
  });

  it('falls back to a random id for a name with no Latin letters or digits', () => {
    expect(slugify('東京', () => 0.5)).toBe(`activity-${(0.5).toString(36).slice(2, 8)}`);
    expect(slugify('!!!')).toMatch(/^activity-[0-9a-z]{1,6}$/);
  });
});
