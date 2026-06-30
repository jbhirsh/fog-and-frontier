import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import { isEffectivelyCompleted, useCompleted } from './userCompleted';
import { apolloClient } from './apolloClient';
import { completedHike, muirWoods } from '../test/fixtures';

// useCompleted reads via useQuery and writes via the module-level apolloClient
// singleton — the same client the app wires into ApolloProvider in prod. We
// render against that singleton and stub fetch so the GraphQL ops resolve,
// then assert the optimistic + persisted cache behavior end-to-end.
type SetCall = { id: string; value: boolean | null };

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ApolloProvider, { client: apolloClient, children });
}

describe('userCompleted', () => {
  let calls: SetCall[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body) as {
          operationName?: string;
          variables?: { input?: { id: string; value: boolean | null } };
        };
        if (body.operationName === 'SetCompleted') {
          const input = body.variables?.input;
          if (input) calls.push({ id: input.id, value: input.value });
          return Promise.resolve(
            jsonResponse({
              data: {
                setCompleted: {
                  __typename: 'SetCompletedPayload',
                  id: input?.id,
                  completed: input?.value ?? null,
                },
              },
            }),
          );
        }
        // Completed read.
        return Promise.resolve(jsonResponse({ data: { completed: [] } }));
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await apolloClient.clearStore();
  });

  it('isEffectivelyCompleted falls back to baseline when no override', () => {
    expect(isEffectivelyCompleted(muirWoods, {})).toBe(false);
    expect(isEffectivelyCompleted(completedHike, {})).toBe(true);
  });

  it('override beats baseline in either direction', () => {
    expect(isEffectivelyCompleted(muirWoods, { [muirWoods.id]: true })).toBe(true);
    expect(
      isEffectivelyCompleted(completedHike, { [completedHike.id]: false }),
    ).toBe(false);
  });

  it('toggle on a non-completed activity optimistically completes it and persists value:true', async () => {
    const { result } = renderHook(() => useCompleted(muirWoods), { wrapper });
    expect(result.current.completed).toBe(false);

    act(() => result.current.toggle());

    await waitFor(() => expect(result.current.completed).toBe(true));
    await waitFor(() =>
      expect(calls).toContainEqual({ id: muirWoods.id, value: true }),
    );
  });

  it('toggle back to baseline clears the override (persists value:null)', async () => {
    const { result } = renderHook(() => useCompleted(muirWoods), { wrapper });

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.completed).toBe(true));
    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.completed).toBe(false));

    await waitFor(() =>
      expect(calls).toContainEqual({ id: muirWoods.id, value: null }),
    );
  });

  it('can unmark a baseline-completed activity (persists value:false)', async () => {
    const { result } = renderHook(() => useCompleted(completedHike), { wrapper });
    expect(result.current.completed).toBe(true);

    act(() => result.current.toggle());

    await waitFor(() => expect(result.current.completed).toBe(false));
    await waitFor(() =>
      expect(calls).toContainEqual({ id: completedHike.id, value: false }),
    );
  });
});
