import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapTilesShown, nothingMoving, waitForMapTiles, waitForStill } from './page-waits';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function tile(complete: boolean, opacity?: string) {
  const img = document.createElement('img');
  img.className = 'leaflet-tile';
  Object.defineProperty(img, 'complete', { value: complete });
  if (opacity !== undefined) img.style.opacity = opacity;
  document.body.append(img);
}

describe('mapTilesShown', () => {
  it('is false before the map has any tile', () => {
    expect(mapTilesShown()).toBe(false);
  });

  it('is true once every tile has finished, loaded or failed, and is opaque', () => {
    tile(true, '1');
    tile(true);
    expect(mapTilesShown()).toBe(true);
  });

  it('is false while a tile is loading or fading in', () => {
    tile(true, '1');
    tile(false);
    expect(mapTilesShown()).toBe(false);
    document.body.innerHTML = '';
    tile(true, '1');
    tile(true, '0.4');
    expect(mapTilesShown()).toBe(false);
  });
});

describe('nothingMoving', () => {
  const animations = (...states: (AnimationPlayState | 'endless')[]) =>
    Object.assign(document, {
      getAnimations: () =>
        states.map(
          (state) =>
            ({
              playState: state === 'endless' ? 'running' : state,
              effect: {
                getComputedTiming: () => ({
                  endTime: state === 'endless' ? Number.POSITIVE_INFINITY : 200,
                }),
              },
            }) as unknown as Animation,
        ),
    });

  it('is true with no animation, or only finished and paused ones', () => {
    animations();
    expect(nothingMoving()).toBe(true);
    animations('finished', 'paused', 'idle');
    expect(nothingMoving()).toBe(true);
  });

  it('is false while one runs', () => {
    animations('finished', 'running');
    expect(nothingMoving()).toBe(false);
  });

  it('counts a running animation with no effect as moving', () => {
    Object.assign(document, {
      getAnimations: () => [{ playState: 'running', effect: null } as unknown as Animation],
    });
    expect(nothingMoving()).toBe(false);
  });

  it('doesn’t wait for one that never ends, such as a spinner', () => {
    animations('endless', 'finished');
    expect(nothingMoving()).toBe(true);
  });
});

describe('the waits', () => {
  it('wait on the page for their check', async () => {
    const waitForFunction = vi.fn(() => Promise.resolve());
    await waitForMapTiles({ waitForFunction } as never);
    await waitForStill({ waitForFunction } as never);
    expect(waitForFunction.mock.calls).toEqual([[mapTilesShown], [nothingMoving]]);
  });
});
