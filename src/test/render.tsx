import type { ReactElement, ReactNode } from 'react';
import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockedResponse } from '@apollo/client/testing';
import type { Activity } from '../data/types';
import { createApolloCache } from '../lib/apolloClient';
import { ACTIVITIES_QUERY, COMPLETED_QUERY } from '../lib/gqlDocs';

// Domain Activity -> the GraphQL ACTIVITIES row (every selected field + the
// __typenames the normalized cache needs). Inverse of rowToActivity; lets tests
// keep using the domain fixtures while seeding the Apollo cache.
export function toActivityRow(a: Activity) {
  return {
    __typename: 'Activity' as const,
    id: a.id,
    name: a.name,
    shortDescription: a.shortDescription,
    longDescription: a.longDescription ?? null,
    category: a.category,
    region: a.region,
    parkType: a.parkType ?? null,
    location: {
      __typename: 'Location' as const,
      city: a.location.city,
      coords: {
        __typename: 'Coords' as const,
        lat: a.location.coords.lat,
        lng: a.location.coords.lng,
      },
    },
    duration: a.duration,
    durationDetail: a.durationDetail ?? null,
    difficulty: a.difficulty ?? null,
    dogFriendly: a.dogFriendly ?? null,
    coverImage: a.coverImage,
    galleryImages: a.galleryImages ?? null,
    allTrailsUrl: a.allTrailsUrl ?? null,
    allTrailsRating: a.allTrailsRating ?? null,
    hikeDistanceMiles: a.hikeDistanceMiles ?? null,
    hikeElevationFeet: a.hikeElevationFeet ?? null,
    cuisine: a.cuisine ?? null,
    priceRange: a.priceRange ?? null,
    hours: a.hours ?? null,
    reservationUrl: a.reservationUrl ?? null,
    menuUrl: a.menuUrl ?? null,
    dietary: a.dietary ?? null,
    completed: a.completed ?? null,
    completedDate: a.completedDate ?? null,
    notes: a.notes ?? null,
  };
}

export type CompletedSeed = { id: string; completed: boolean };

function completedRows(completed: CompletedSeed[]) {
  return completed.map((c) => ({
    __typename: 'CompletedEntry' as const,
    id: c.id,
    completed: c.completed,
  }));
}

export type ApolloRenderOptions = Omit<RenderOptions, 'wrapper'> & {
  /** Catalog activities seeded into the cache (read synchronously by reads). */
  activities?: Activity[];
  /** Completed overrides seeded into the cache. */
  completed?: CompletedSeed[];
  /** Extra mocks (e.g. for mutations) appended to the defaults. */
  mocks?: MockedResponse[];
};

// Wraps the tree in a MockedProvider whose cache is pre-seeded so the
// cache-and-network reads (activities/completed) resolve synchronously on the
// first render — keeping existing getBy assertions valid. The default mocks let
// the background network fetch resolve cleanly.
export function render(
  ui: ReactElement,
  { activities, completed = [], mocks = [], ...rtl }: ApolloRenderOptions = {},
) {
  const cache = createApolloCache();
  const activityData = (activities ?? []).map(toActivityRow);
  const completedData = completedRows(completed);

  if (activities) {
    cache.writeQuery({ query: ACTIVITIES_QUERY, data: { activities: activityData } });
  }
  cache.writeQuery({ query: COMPLETED_QUERY, data: { completed: completedData } });

  const defaultMocks: MockedResponse[] = [
    {
      request: { query: ACTIVITIES_QUERY },
      result: { data: { activities: activityData } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
    {
      request: { query: COMPLETED_QUERY },
      result: { data: { completed: completedData } },
      maxUsageCount: Number.POSITIVE_INFINITY,
    },
  ];

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MockedProvider cache={cache} mocks={[...defaultMocks, ...mocks]}>
        {children}
      </MockedProvider>
    );
  }

  return rtlRender(ui, { wrapper: Wrapper, ...rtl });
}

export {
  screen,
  within,
  fireEvent,
  act,
  waitFor,
  renderHook,
  cleanup,
} from '@testing-library/react';
