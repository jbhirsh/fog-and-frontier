import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { HOME_LOCATION } from '../data/home';
import {
  deviceOrigin,
  HOME_ORIGIN,
  localAnswerStore,
  locateVisitor,
  LOCATION_STORAGE_KEY,
  POSITION_OPTIONS,
  useDistanceOrigin,
  type AnswerStore,
} from './distanceOrigin';

const HERE = { latitude: 37.77, longitude: -122.42 };

function memoryStore(initial: 'granted' | 'denied' | null = null) {
  let answer = initial;
  return {
    get: vi.fn(() => answer),
    set: vi.fn((next: 'granted' | 'denied') => {
      answer = next;
    }),
  } satisfies AnswerStore;
}

// A geolocation stand-in that answers with a position or an error code.
function geolocation(result: { coords: typeof HERE } | { code: number }) {
  return {
    getCurrentPosition: vi.fn(
      (ok: PositionCallback, fail?: PositionErrorCallback | null) => {
        if ('coords' in result) ok({ coords: result.coords } as GeolocationPosition);
        else fail?.({ code: result.code } as GeolocationPositionError);
      },
    ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('origins', () => {
  it('names home by its town, short and long', () => {
    expect(HOME_ORIGIN).toEqual({
      source: 'home',
      coords: HOME_LOCATION.coords,
      name: 'San Jose',
      label: 'San Jose, CA',
    });
  });

  it('names the device "you"', () => {
    expect(deviceOrigin(HERE)).toEqual({
      source: 'device',
      coords: { lat: 37.77, lng: -122.42 },
      name: 'you',
      label: 'you',
    });
  });

  it('measures from home outside a provider', () => {
    expect(renderHook(() => useDistanceOrigin()).result.current).toBe(HOME_ORIGIN);
  });
});

describe('locateVisitor', () => {
  it('asks on the first visit, coarse and recent, and remembers a yes', () => {
    const geo = geolocation({ coords: HERE });
    const store = memoryStore();
    const onOrigin = vi.fn();
    locateVisitor(geo, store, onOrigin);
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 10_000 },
    );
    expect(POSITION_OPTIONS).toEqual({
      enableHighAccuracy: false,
      maximumAge: 600_000,
      timeout: 10_000,
    });
    expect(store.set).toHaveBeenCalledExactlyOnceWith('granted');
    expect(onOrigin).toHaveBeenCalledExactlyOnceWith(deviceOrigin(HERE));
  });

  it('asks again on a later visit after a yes, for a fresh position', () => {
    const geo = geolocation({ coords: HERE });
    const onOrigin = vi.fn();
    locateVisitor(geo, memoryStore('granted'), onOrigin);
    expect(geo.getCurrentPosition).toHaveBeenCalledOnce();
    expect(onOrigin).toHaveBeenCalledOnce();
  });

  it('remembers a no, and does not ask again', () => {
    const store = memoryStore();
    const onOrigin = vi.fn();
    locateVisitor(geolocation({ code: 1 }), store, onOrigin);
    expect(store.set).toHaveBeenCalledExactlyOnceWith('denied');
    expect(onOrigin).not.toHaveBeenCalled();

    const geo = geolocation({ coords: HERE });
    locateVisitor(geo, store, onOrigin);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(onOrigin).not.toHaveBeenCalled();
  });

  it('uses the position after a "no" once the browser now allows it', async () => {
    const geo = geolocation({ coords: HERE });
    const store = memoryStore('denied');
    const onOrigin = vi.fn();
    const query = vi.fn(() => Promise.resolve({ state: 'granted' } as PermissionStatus));
    locateVisitor(geo, store, onOrigin, { query });
    expect(query).toHaveBeenCalledExactlyOnceWith({ name: 'geolocation' });
    await vi.waitFor(() => expect(onOrigin).toHaveBeenCalledOnce());
    expect(store.set).toHaveBeenCalledExactlyOnceWith('granted');
  });

  it.each(['prompt', 'denied'] as const)(
    'keeps a stored "no" while the browser reports %s',
    async (state) => {
      const geo = geolocation({ coords: HERE });
      const query = vi.fn(() => Promise.resolve({ state } as PermissionStatus));
      locateVisitor(geo, memoryStore('denied'), vi.fn(), { query });
      await Promise.resolve();
      await Promise.resolve();
      expect(query).toHaveBeenCalledOnce();
      expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    },
  );

  it('keeps a stored "no" when the Permissions API fails', async () => {
    const geo = geolocation({ coords: HERE });
    const query = vi.fn(() => Promise.reject(new Error('unsupported')));
    locateVisitor(geo, memoryStore('denied'), vi.fn(), { query });
    await Promise.resolve();
    await Promise.resolve();
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  it('does not check permissions without a stored "no"', () => {
    const query = vi.fn(() => Promise.resolve({ state: 'granted' } as PermissionStatus));
    locateVisitor(geolocation({ coords: HERE }), memoryStore(), vi.fn(), { query });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['unavailable', 2],
    ['timed out', 3],
  ])('does not remember a position that was %s, so the next visit retries', (_, code) => {
    const store = memoryStore();
    const onOrigin = vi.fn();
    locateVisitor(geolocation({ code }), store, onOrigin);
    expect(store.set).not.toHaveBeenCalled();
    expect(onOrigin).not.toHaveBeenCalled();
  });

  it('does nothing without geolocation', () => {
    const store = memoryStore('denied');
    const onOrigin = vi.fn();
    const query = vi.fn(() => Promise.resolve({ state: 'granted' } as PermissionStatus));
    locateVisitor(undefined, store, onOrigin, { query });
    expect(store.get).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(onOrigin).not.toHaveBeenCalled();
  });
});

describe('localAnswerStore', () => {
  it('keeps the answer in localStorage', () => {
    expect(localAnswerStore.get()).toBeNull();
    localAnswerStore.set('denied');
    expect(localStorage.getItem(LOCATION_STORAGE_KEY)).toBe('denied');
    expect(localAnswerStore.get()).toBe('denied');
    localAnswerStore.set('granted');
    expect(localAnswerStore.get()).toBe('granted');
  });

  it('uses a versioned key', () => {
    expect(LOCATION_STORAGE_KEY).toBe('fogandfrontier.location.v1');
  });

  it('ignores anything else stored under the key', () => {
    localStorage.setItem(LOCATION_STORAGE_KEY, 'maybe');
    expect(localAnswerStore.get()).toBeNull();
  });

  it('fails soft when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(localAnswerStore.get()).toBeNull();
    expect(() => localAnswerStore.set('granted')).not.toThrow();
  });
});
