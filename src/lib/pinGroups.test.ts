import { describe, expect, it } from 'vitest';
import {
  GROUP_MAX_SIZE,
  GROUP_RADIUS_PX,
  drawPins,
  groupPins,
  groupSize,
  type MapPin,
  type Project,
} from './pinGroups';

describe('groupPins', () => {
  it('leaves pins far enough apart on their own', () => {
    expect(
      groupPins([
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: GROUP_RADIUS_PX, y: 0 },
      ]),
    ).toEqual([
      { ids: ['a'], x: 0, y: 0 },
      { ids: ['b'], x: GROUP_RADIUS_PX, y: 0 },
    ]);
  });

  it('groups pins that would overlap, drawn at the seed', () => {
    expect(
      groupPins([
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: GROUP_RADIUS_PX - 1, y: 0 },
      ]),
    ).toEqual([{ ids: ['a', 'b'], x: 0, y: 0 }]);
  });

  it('seeds the group with the pin that has the most neighbours', () => {
    // b sits between a and c, near both; a and c are too far apart to group.
    const groups = groupPins(
      [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 30, y: 0 },
        { id: 'c', x: 60, y: 0 },
      ],
      40,
    );
    expect(groups).toEqual([{ ids: ['b', 'a', 'c'], x: 30, y: 0 }]);
  });

  it('breaks a tie by the lower id, whatever order the pins come in', () => {
    const pins = [
      { id: 'b', x: 10, y: 0 },
      { id: 'a', x: 0, y: 0 },
    ];
    expect(groupPins(pins)).toEqual([{ ids: ['a', 'b'], x: 0, y: 0 }]);
    expect(groupPins([...pins].reverse())).toEqual(groupPins(pins));
  });

  it('seeds with the pin it is told to first, however few its neighbours', () => {
    const pins = [
      { id: 'home', x: 0, y: 0 },
      { id: 'b', x: 30, y: 0 },
      { id: 'c', x: 60, y: 0 },
    ];
    // b would seed, holding both; home seeds instead, holding only b.
    expect(groupPins(pins, 40)).toEqual([{ ids: ['b', 'c', 'home'], x: 30, y: 0 }]);
    expect(groupPins(pins, 40, 'home')).toEqual([
      { ids: ['home', 'b'], x: 0, y: 0 },
      { ids: ['c'], x: 60, y: 0 },
    ]);
  });

  it('groups nothing out of no pins', () => {
    expect(groupPins([])).toEqual([]);
  });
});

describe('groupSize', () => {
  it('grows with the count, and stops at its widest', () => {
    expect(groupSize(2)).toBe(34);
    expect(groupSize(4)).toBe(37);
    expect(groupSize(16)).toBe(43);
    expect(groupSize(1000)).toBe(GROUP_MAX_SIZE);
    expect(groupSize(0)).toBe(34);
  });

  it('stays narrower than the space between groups', () => {
    expect(GROUP_MAX_SIZE).toBeLessThan(GROUP_RADIUS_PX);
  });
});

// A flat projection: a degree is a pixel at zoom 0, doubling with each zoom.
const project: Project = (lat, lng, zoom) => ({ x: lng * 2 ** zoom, y: -lat * 2 ** zoom });
const HOME = { lat: 0, lng: 0 };
const pin = (id: string, lng: number, minor = false): MapPin => ({ id, lat: 0, lng, minor });

describe('drawPins', () => {
  it('draws home alone, with nothing beside it', () => {
    expect(drawPins([pin('far', 100)], HOME, project, 0, 4)).toEqual([
      { ids: [], lat: 0, lng: 0, home: true, minor: false, splits: true },
      { ids: ['far'], lat: 0, lng: 100, home: false, minor: false, splits: true },
    ]);
  });

  it('gives home the places beside it, home staying put', () => {
    const [home] = drawPins([pin('a', 10), pin('b', 20)], HOME, project, 0, 4);
    expect(home).toEqual({
      ids: ['a', 'b'],
      lat: 0,
      lng: 0,
      home: true,
      minor: false,
      splits: true,
    });
  });

  it('groups places that would overlap, at their seed, and parts them on zooming in', () => {
    const pins = [pin('a', 200), pin('b', 210), pin('c', 220)];
    expect(drawPins(pins, HOME, project, 0, 4)).toContainEqual({
      ids: ['a', 'b', 'c'],
      lat: 0,
      lng: 200,
      home: false,
      minor: false,
      splits: true,
    });
    // At zoom 4 they're 160px apart: each on its own.
    expect(drawPins(pins, HOME, project, 4, 4).map((d) => d.ids)).toEqual([
      [],
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('says when not even the deepest zoom parts a group', () => {
    const [, group] = drawPins([pin('a', 200), pin('b', 200)], HOME, project, 0, 4);
    expect(group).toEqual(expect.objectContaining({ ids: ['a', 'b'], splits: false }));
    const [home] = drawPins([pin('a', 0)], HOME, project, 0, 4);
    expect(home).toEqual(expect.objectContaining({ ids: ['a'], home: true, splits: false }));
  });

  it('marks a group minor only when every place in it is a far dot', () => {
    const minor = drawPins([pin('a', 200, true), pin('b', 210, true)], HOME, project, 0, 0);
    expect(minor[1]).toEqual(expect.objectContaining({ ids: ['a', 'b'], minor: true }));
    const mixed = drawPins([pin('a', 200, true), pin('b', 210)], HOME, project, 0, 0);
    expect(mixed[1]).toEqual(expect.objectContaining({ minor: false }));
    // Home is never minor, whatever is beside it.
    expect(drawPins([pin('a', 1, true)], HOME, project, 0, 0)[0].minor).toBe(false);
  });
});
