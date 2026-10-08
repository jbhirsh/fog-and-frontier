import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockedResponse } from '@apollo/client/testing';
import userEvent from '@testing-library/user-event';
import { GraphQLError } from 'graphql';
import { DrivingMilesProvider } from './DrivingMilesProvider';
import { DRIVING_MILES_QUERY } from '../lib/gqlDocs';
import { DistanceOriginCtx, HOME_ORIGIN, deviceOrigin } from '../lib/distanceOrigin';
import { formatMiles, useDistanceTo } from '../lib/drivingMiles';

const MUIR = { id: 'muir', location: { coords: { lat: 37.897, lng: -122.5811 } } };
const VISITOR = deviceOrigin({ latitude: 37.77412, longitude: -122.41948 });

function Probe() {
  return <p>{formatMiles(useDistanceTo()(MUIR))} mi</p>;
}

function drivingMock(lat: number, lng: number, miles: number): MockedResponse {
  return {
    request: { query: DRIVING_MILES_QUERY, variables: { lat, lng } },
    result: { data: { drivingMiles: [{ __typename: 'DrivingDistance', id: 'muir', miles }] } },
  };
}

function Harness() {
  const [origin, setOrigin] = useState(HOME_ORIGIN);
  return (
    <DistanceOriginCtx.Provider value={origin}>
      <button type="button" onClick={() => setOrigin(VISITOR)}>
        share location
      </button>
      <button type="button" onClick={() => setOrigin(HOME_ORIGIN)}>
        back home
      </button>
      <DrivingMilesProvider>
        <Probe />
      </DrivingMilesProvider>
    </DistanceOriginCtx.Provider>
  );
}

describe('DrivingMilesProvider', () => {
  it('shows a straight-line estimate, then road miles from the coarse origin', async () => {
    render(
      <MockedProvider mocks={[drivingMock(37.34, -121.89, 71.2)]}>
        <Harness />
      </MockedProvider>,
    );
    expect(screen.getByText('≈54 mi')).toBeInTheDocument();
    expect(await screen.findByText('71 mi')).toBeInTheDocument();
  });

  it('asks again from the visitor once they share their location', async () => {
    render(
      <MockedProvider
        mocks={[drivingMock(37.34, -121.89, 71.2), drivingMock(37.77, -122.42, 18.6)]}
      >
        <Harness />
      </MockedProvider>,
    );
    await screen.findByText('71 mi');
    await userEvent.click(screen.getByRole('button', { name: 'share location' }));
    // The home origin's road miles never stand in for the visitor's.
    expect(screen.getByText('≈12 mi')).toBeInTheDocument();
    expect(await screen.findByText('19 mi')).toBeInTheDocument();
  });

  it("keeps each origin's road miles separate", async () => {
    render(
      <MockedProvider
        mocks={[
          drivingMock(37.34, -121.89, 71.2),
          drivingMock(37.77, -122.42, 18.6),
          drivingMock(37.34, -121.89, 71.2),
        ]}
      >
        <Harness />
      </MockedProvider>,
    );
    await screen.findByText('71 mi');
    await userEvent.click(screen.getByRole('button', { name: 'share location' }));
    await screen.findByText('19 mi');
    await userEvent.click(screen.getByRole('button', { name: 'back home' }));
    expect(await screen.findByText('71 mi')).toBeInTheDocument();
  });

  it('keeps the estimate when routing fails', async () => {
    const answered = vi.fn(() => ({ errors: [new GraphQLError('down')] }));
    render(
      <MockedProvider
        mocks={[
          {
            request: { query: DRIVING_MILES_QUERY, variables: { lat: 37.34, lng: -121.89 } },
            result: answered,
          },
        ]}
      >
        <Harness />
      </MockedProvider>,
    );
    await waitFor(() => expect(answered).toHaveBeenCalled());
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.getByText('≈54 mi')).toBeInTheDocument();
  });
});
