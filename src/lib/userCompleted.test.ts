import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApolloProvider } from '@apollo/client/react';
import {
  applyCompletionMirror,
  isEffectivelyCompleted,
  setCompleted,
  useCompleted,
  useOverrides,
} from './userCompleted';
import { apolloClient } from './apolloClient';
import { COMPLETED_QUERY } from './gqlDocs';
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

function seedCompleted(entries: [string, boolean][]) {
  apolloClient.cache.writeQuery({
    query: COMPLETED_QUERY,
    data: {
      completed: entries.map(([id, completed]) => ({
        __typename: 'CompletedEntry' as const,
        id,
        completed,
      })),
    },
  });
}

// The cached COMPLETED_QUERY list as sorted [id, completed] pairs, or null
// when nothing has been cached.
function cachedCompleted(): [string, boolean][] | null {
  const data = apolloClient.cache.readQuery({ query: COMPLETED_QUERY });
  if (!data) return null;
  return data.completed
    .map((e): [string, boolean] => [e.id, e.completed])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

describe('userCompleted', () => {
  let calls: SetCall[];
  // SetCompleted responses wait on this, so a test can hold the server reply
  // and look at the optimistic state.
  let gate: Promise<void>;

  beforeEach(() => {
    calls = [];
    gate = Promise.resolve();
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
          return gate.then(() =>
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
  it('shows the toggle before the server answers (optimistic)', async () => {
    let release: () => void = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    const { result } = renderHook(() => useCompleted(muirWoods), { wrapper });
    await waitFor(() =>
      expect(apolloClient.cache.readQuery({ query: COMPLETED_QUERY })).not.toBeNull(),
    );

    act(() => result.current.toggle());

    await waitFor(() => expect(result.current.completed).toBe(true));
    expect(calls).toEqual([{ id: muirWoods.id, value: true }]);
    release();
    await waitFor(() => expect(cachedCompleted()).toEqual([[muirWoods.id, true]]));
  });

  it('setCompleted upserts its entry and keeps the others', async () => {
    seedCompleted([
      ['other', true],
      [muirWoods.id, false],
    ]);
    await setCompleted(muirWoods.id, true);
    expect(cachedCompleted()).toEqual([
      ['other', true],
      [muirWoods.id, true],
    ]);
  });

  it('setCompleted with null removes the override entry', async () => {
    seedCompleted([
      ['other', true],
      [muirWoods.id, true],
    ]);
    await setCompleted(muirWoods.id, null);
    expect(cachedCompleted()).toEqual([['other', true]]);
  });

  describe('applyCompletionMirror', () => {
    it('marks completed and uncompleted ids, keeping other entries', () => {
      seedCompleted([
        ['keep', true],
        ['flip', true],
      ]);
      applyCompletionMirror(['new'], ['flip']);
      expect(cachedCompleted()).toEqual([
        ['flip', false],
        ['keep', true],
        ['new', true],
      ]);
    });

    it('mirrors completed ids when nothing was left unchecked', () => {
      seedCompleted([['keep', false]]);
      applyCompletionMirror(['new'], []);
      expect(cachedCompleted()).toEqual([
        ['keep', false],
        ['new', true],
      ]);
    });

    it('mirrors unchecked ids when nothing was completed', () => {
      seedCompleted([['keep', true]]);
      applyCompletionMirror([], ['stale']);
      expect(cachedCompleted()).toEqual([
        ['keep', true],
        ['stale', false],
      ]);
    });

    it('leaves the cache untouched when there is nothing to mirror', () => {
      applyCompletionMirror([], []);
      expect(cachedCompleted()).toBeNull();
    });
  });

  // Race: the first COMPLETED read is still in flight when the owner toggles,
  // and that read was answered before the mutation committed, so it lands
  // carrying pre-toggle data. The screen must end up matching the server.
  it('a toggle made while the first read is in flight survives that read landing with older data', async () => {
    const server = new Map<string, boolean>([['other-activity', true]]);
    const snapshot = () => ({
      data: {
        completed: [...server].map(([id, completed]) => ({
          __typename: 'CompletedEntry',
          id,
          completed,
        })),
      },
    });
    let reads = 0;
    let releaseFirstRead: (() => void) | null = null;
    let mutated = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body) as {
          operationName?: string;
          variables?: { input?: { id: string; value: boolean | null } };
        };
        if (body.operationName === 'SetCompleted') {
          const input = body.variables?.input;
          if (!input) throw new Error('missing input');
          if (input.value === null) server.delete(input.id);
          else server.set(input.id, input.value);
          mutated = true;
          return Promise.resolve(
            jsonResponse({
              data: {
                setCompleted: {
                  __typename: 'SetCompletedPayload',
                  id: input.id,
                  completed: input.value,
                },
              },
            }),
          );
        }
        reads += 1;
        if (reads === 1) {
          const stale = snapshot(); // answered before the toggle
          return new Promise<Response>((resolve) => {
            releaseFirstRead = () => resolve(jsonResponse(stale));
          });
        }
        return Promise.resolve(jsonResponse(snapshot()));
      }),
    );

    const { result } = renderHook(
      () => ({ item: useCompleted(muirWoods), overrides: useOverrides() }),
      { wrapper },
    );
    await waitFor(() => expect(releaseFirstRead).not.toBeNull());

    act(() => result.current.item.toggle());
    await waitFor(() => expect(mutated).toBe(true));
    // Let the mutation's response settle before the stale read lands.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    act(() => releaseFirstRead?.());

    const expected = { 'other-activity': true, [muirWoods.id]: true };
    expect(Object.fromEntries(server)).toEqual(expected);
    await waitFor(() => expect(result.current.overrides).toEqual(expected));
    // ...and stays there once everything in flight has settled.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.overrides).toEqual(expected);
    expect(result.current.item.completed).toBe(true);
  });

  it('shows a saved toggle even when the list cannot be read at all', async () => {
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body) as {
          operationName?: string;
          variables?: { input?: { id: string; value: boolean | null } };
        };
        if (body.operationName === 'SetCompleted') {
          const input = body.variables?.input;
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
        reads += 1;
        return Promise.resolve(jsonResponse({ errors: [{ message: 'boom' }] }));
      }),
    );
    const { result } = renderHook(() => useCompleted(muirWoods), { wrapper });
    await waitFor(() => expect(reads).toBeGreaterThan(0));

    act(() => result.current.toggle());

    await waitFor(() => expect(result.current.completed).toBe(true));
  });

  describe('applyCompletionMirror', () => {
    function cachedList() {
      return apolloClient.cache.readQuery({ query: COMPLETED_QUERY })?.completed;
    }

    it('merges into a cached list', () => {
      apolloClient.cache.writeQuery({
        query: COMPLETED_QUERY,
        data: {
          completed: [
            { __typename: 'CompletedEntry', id: 'keep', completed: true },
            { __typename: 'CompletedEntry', id: 'flip', completed: true },
          ],
        },
      });
      applyCompletionMirror(['new'], ['flip']);
      expect(
        Object.fromEntries((cachedList() ?? []).map((e) => [e.id, e.completed])),
      ).toEqual({ keep: true, flip: false, new: true });
    });

    it('writes no partial list when nothing is cached yet', () => {
      applyCompletionMirror(['new'], ['old']);
      expect(cachedList()).toBeUndefined();
    });
  });
});
