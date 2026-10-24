import { describe, expect, it } from 'vitest';
import type { Activity } from '../data/types';
import { nestUnderParks, parkChoices, parkOf, subItemsLabel, subItemsOf } from './parks';

function activity(id: string, parentId?: string, name = id): Activity {
  return {
    id,
    name,
    shortDescription: '',
    category: 'hiking',
    region: 'north-bay',
    location: { city: 'Inverness', coords: { lat: 38, lng: -122.9 } },
    duration: 'Full Day',
    coverImage: '',
    parentId,
  };
}

const PARK = activity('point-reyes');
const LIGHTHOUSE = activity('lighthouse', 'point-reyes');
const CHIMNEY = activity('chimney-rock', 'point-reyes');
const MUIR = activity('muir-woods');

const ids = (list: Activity[]) => list.map((a) => a.id);

describe('nestUnderParks', () => {
  it('holds a park’s hikes and stops under it, in the list’s order', () => {
    const { top, subItems } = nestUnderParks([LIGHTHOUSE, PARK, MUIR, CHIMNEY]);
    expect(ids(top)).toEqual(['point-reyes', 'muir-woods']);
    expect(ids(subItems.get('point-reyes') ?? [])).toEqual(['lighthouse', 'chimney-rock']);
    expect(subItems.has('muir-woods')).toBe(false);
  });

  it('leaves a hike at the top when its park isn’t in the list', () => {
    const { top, subItems } = nestUnderParks([LIGHTHOUSE, MUIR]);
    expect(ids(top)).toEqual(['lighthouse', 'muir-woods']);
    expect(subItems.size).toBe(0);
  });

  it('never nests twice, nor under itself, so nothing disappears', () => {
    const marin = activity('marin');
    const nestedPark = activity('point-reyes', 'marin');
    const looped = activity('loop', 'loop');
    const { top, subItems } = nestUnderParks([marin, nestedPark, LIGHTHOUSE, looped]);
    // The park nests under Marin; its own hike can't nest under a nested park.
    expect(ids(top)).toEqual(['marin', 'lighthouse', 'loop']);
    expect(ids(subItems.get('marin') ?? [])).toEqual(['point-reyes']);
    expect(subItems.has('point-reyes')).toBe(false);
    expect(subItems.has('loop')).toBe(false);
  });

  it('keeps both of two activities naming each other at the top', () => {
    const a = activity('a', 'b');
    const b = activity('b', 'a');
    const { top, subItems } = nestUnderParks([a, b]);
    expect(ids(top)).toEqual(['a', 'b']);
    expect(subItems.size).toBe(0);
  });

  it('has nothing to nest in an empty list', () => {
    expect(nestUnderParks([])).toEqual({ top: [], subItems: new Map() });
  });
});

describe('parkOf', () => {
  it('finds the park an activity is part of', () => {
    expect(parkOf(LIGHTHOUSE, [MUIR, PARK])).toBe(PARK);
  });

  it('finds none without a parent, for a parent that isn’t there, or for itself', () => {
    expect(parkOf(MUIR, [PARK, MUIR])).toBeUndefined();
    expect(parkOf(LIGHTHOUSE, [MUIR])).toBeUndefined();
    const looped = activity('loop', 'loop');
    expect(parkOf(looped, [looped])).toBeUndefined();
  });
});

describe('subItemsOf', () => {
  it('lists a park’s hikes and stops by name', () => {
    const tomales = activity('tomales', 'point-reyes', 'Tomales Point Trail');
    const chimney = activity('chimney-rock', 'point-reyes', 'Chimney Rock Trail');
    expect(subItemsOf(PARK, [tomales, MUIR, PARK, chimney])).toEqual([chimney, tomales]);
  });

  it('never lists the park itself, and lists nothing for a park without any', () => {
    const looped = activity('loop', 'loop');
    expect(subItemsOf(looped, [looped])).toEqual([]);
    expect(subItemsOf(MUIR, [PARK, LIGHTHOUSE, MUIR])).toEqual([]);
  });
});

describe('subItemsLabel', () => {
  it('counts them', () => {
    expect(subItemsLabel(1)).toBe('1 hike or stop');
    expect(subItemsLabel(6)).toBe('6 hikes & stops');
  });
});

describe('parkChoices', () => {
  it('offers every saved activity that isn’t part of another, but itself, by name', () => {
    const yosemite = activity('yosemite', undefined, 'Yosemite National Park');
    const reyes = activity('point-reyes', undefined, 'Point Reyes National Seashore');
    const lighthouse = activity('lighthouse', 'point-reyes', 'Point Reyes Lighthouse');
    const muir = activity('muir-woods', undefined, 'Muir Woods');
    expect(parkChoices(muir, [yosemite, lighthouse, muir, reyes])).toEqual([reyes, yosemite]);
  });
});
