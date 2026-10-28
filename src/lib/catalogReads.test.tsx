import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import { apolloClient } from './apolloClient';
import { useUserActivities } from './userActivities';
import { useOverrides } from './userCompleted';
import { toActivityRow } from '../test/render';
import { muirWoods } from '../test/fixtures';

// Every card reads the completion overrides, and the detail (and each
// neighbour beside it) reads the catalog. Those readers mount long after the
// first read has landed, as the list pages in and as the detail steps
// through the list: each must read the cache, not fetch the 650 KB catalog
// again.

const REPLIES: Record<string, unknown> = {
  Activities: { activities: [toActivityRow(muirWoods)] },
  Completed: { completed: [{ __typename: 'CompletedEntry', id: muirWoods.id, completed: true }] },
};

function stubFetch() {
  const ops: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<(url: string, init: RequestInit) => Promise<Response>>((_url, init) => {
      const { operationName } = JSON.parse(init.body as string) as { operationName: string };
      ops.push(operationName);
      return Promise.resolve(
        new Response(JSON.stringify({ data: REPLIES[operationName] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return ops;
}

function wrapper({ children }: { children: ReactNode }) {
  return <ApolloProvider client={apolloClient}>{children}</ApolloProvider>;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

describe('catalog reads', () => {
  it('fetches the catalog once, however many readers mount after it lands', async () => {
    const ops = stubFetch();
    const first = renderHook(() => useUserActivities(), { wrapper });
    await waitFor(() => expect(first.result.current.activities).toHaveLength(1));

    const later = renderHook(() => useUserActivities(), { wrapper });
    expect(later.result.current.activities.map((a) => a.id)).toEqual([muirWoods.id]);
    expect(later.result.current.loading).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(ops.filter((op) => op === 'Activities')).toHaveLength(1);
  });

  it('fetches the completion overrides once, however many cards mount after them', async () => {
    const ops = stubFetch();
    const first = renderHook(() => useOverrides(), { wrapper });
    await waitFor(() => expect(first.result.current).toEqual({ [muirWoods.id]: true }));

    const later = renderHook(() => useOverrides(), { wrapper });
    expect(later.result.current).toEqual({ [muirWoods.id]: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(ops.filter((op) => op === 'Completed')).toHaveLength(1);
  });
});
