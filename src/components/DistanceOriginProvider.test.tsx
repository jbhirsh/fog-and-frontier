import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DistanceOriginProvider } from './DistanceOriginProvider';
import { LOCATION_STORAGE_KEY, useDistanceOrigin } from '../lib/distanceOrigin';

function Probe() {
  const origin = useDistanceOrigin();
  return <p>from {origin.label}</p>;
}

function stubGeolocation(getCurrentPosition: Geolocation['getCurrentPosition'] | undefined) {
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: getCurrentPosition ? { getCurrentPosition } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('DistanceOriginProvider', () => {
  it('measures from the visitor once they share their location', () => {
    stubGeolocation((ok) =>
      ok({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition),
    );
    render(
      <DistanceOriginProvider>
        <Probe />
      </DistanceOriginProvider>,
    );
    expect(screen.getByText('from you')).toBeInTheDocument();
    expect(localStorage.getItem(LOCATION_STORAGE_KEY)).toBe('granted');
  });

  it('measures from home when they decline', () => {
    stubGeolocation((_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError));
    render(
      <DistanceOriginProvider>
        <Probe />
      </DistanceOriginProvider>,
    );
    expect(screen.getByText('from Campbell, CA')).toBeInTheDocument();
    expect(localStorage.getItem(LOCATION_STORAGE_KEY)).toBe('denied');
  });

  it('uses the position after an earlier "no" once the browser allows it', async () => {
    localStorage.setItem(LOCATION_STORAGE_KEY, 'denied');
    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition),
      },
      permissions: { query: () => Promise.resolve({ state: 'granted' }) },
    });
    render(
      <DistanceOriginProvider>
        <Probe />
      </DistanceOriginProvider>,
    );
    expect(await screen.findByText('from you')).toBeInTheDocument();
  });

  it('measures from home without geolocation', () => {
    stubGeolocation(undefined);
    render(
      <DistanceOriginProvider>
        <Probe />
      </DistanceOriginProvider>,
    );
    expect(screen.getByText('from Campbell, CA')).toBeInTheDocument();
  });
});
