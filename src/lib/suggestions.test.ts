import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { ACTIVITIES_QUERY, PENDING_SUGGESTIONS } from './gqlDocs';
import {
  acceptSuggestion,
  refreshSuggestions,
  rejectSuggestion,
  suggestUserActivity,
  usePendingSuggestions,
} from './suggestions';

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

function reply(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const ACTIVITY: Activity = {
  id: 'fort-funston',
  name: 'Fort Funston',
  shortDescription: 'Bluffs',
  category: 'scenic',
  region: 'sf',
  location: { city: 'San Francisco', coords: { lat: 37.7, lng: -122.5 } },
  duration: 'Half Day',
  coverImage: '',
  completed: true,
  completedDate: '2026-01-01',
  contributors: ['friend@example.com'],
};

function stubReply(body: unknown) {
  const sent: { input?: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, opts: { body: string }) => {
      sent.push(
        (JSON.parse(opts.body) as { variables: { input: Record<string, unknown> } }).variables,
      );
      return Promise.resolve(reply(body));
    }),
  );
  return sent;
}

const OK = {
  data: {
    suggestActivity: {
      __typename: 'SuggestActivityPayload',
      suggestion: { __typename: 'SuggestionRef', id: 's1' },
    },
  },
};

describe('suggestUserActivity (#73)', () => {
  it('sends the activity without completion or credit, and returns the id', async () => {
    const sent = stubReply(OK);
    expect(await suggestUserActivity(ACTIVITY)).toBe('s1');
    const input = sent[0].input as { activity: Record<string, unknown> };
    expect(input).not.toHaveProperty('allowDuplicate');
    expect(input.activity).toMatchObject({
      name: 'Fort Funston',
      category: 'scenic',
      completed: null,
      completedDate: null,
      contributors: null,
    });
    expect(input.activity).not.toHaveProperty('id');
  });

  it('says when it should go ahead despite a look-alike', async () => {
    const sent = stubReply(OK);
    await suggestUserActivity(ACTIVITY, { allowDuplicate: true });
    expect(sent[0].input).toMatchObject({ allowDuplicate: true });
  });

  it('throws on an empty answer', async () => {
    stubReply({ data: null });
    await expect(suggestUserActivity(ACTIVITY)).rejects.toThrow('Failed to send the suggestion');
  });
});

function stubOps(answers: Record<string, unknown>) {
  const calls: { op: string; variables: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body) as {
        operationName: string;
        variables: Record<string, unknown>;
      };
      calls.push({ op: body.operationName, variables: body.variables });
      return Promise.resolve(reply(answers[body.operationName] ?? { data: null }));
    }),
  );
  return calls;
}

const ACCEPTED = {
  data: {
    acceptSuggestion: {
      __typename: 'AcceptSuggestionPayload',
      activity: { __typename: 'Activity', id: 'fort-funston', name: 'Fort Funston' },
    },
  },
};

describe('acceptSuggestion (#73)', () => {
  it('accepts it, refetches the catalog and the queue, and returns the catalog id', async () => {
    const calls = stubOps({ AcceptSuggestion: ACCEPTED });
    expect(await acceptSuggestion('s1')).toBe('fort-funston');
    expect(calls[0]).toEqual({ op: 'AcceptSuggestion', variables: { id: 's1' } });
    expect(calls.map((c) => c.op)).toEqual(
      expect.arrayContaining(['Activities', 'PendingSuggestions']),
    );
  });

  it('says when to accept a look-alike anyway', async () => {
    const calls = stubOps({ AcceptSuggestion: ACCEPTED });
    await acceptSuggestion('s1', { allowDuplicate: true });
    expect(calls[0].variables).toEqual({ id: 's1', allowDuplicate: true });
  });

  it('throws on an empty answer', async () => {
    stubOps({});
    await expect(acceptSuggestion('s1')).rejects.toThrow('Failed to accept the suggestion');
  });
});

describe('rejectSuggestion (#73)', () => {
  it('rejects it and refetches the queue', async () => {
    const calls = stubOps({
      RejectSuggestion: {
        data: { rejectSuggestion: { __typename: 'RejectSuggestionPayload', id: 's1' } },
      },
    });
    await rejectSuggestion('s1');
    expect(calls[0]).toEqual({ op: 'RejectSuggestion', variables: { id: 's1' } });
    expect(calls.map((c) => c.op)).toContain('PendingSuggestions');
    expect(calls.map((c) => c.op)).not.toContain('Activities');
  });
});

describe('refreshSuggestions (#73)', () => {
  it('refetches the queue and the catalog that are being watched', async () => {
    const spy = vi
      .spyOn(apolloClient, 'refetchQueries')
      .mockReturnValue(
        Promise.resolve([]) as unknown as ReturnType<typeof apolloClient.refetchQueries>,
      );
    await refreshSuggestions();
    expect(spy).toHaveBeenCalledWith({ include: [PENDING_SUGGESTIONS, ACTIVITIES_QUERY] });
    spy.mockRestore();
  });
});

describe('usePendingSuggestions (#73)', () => {
  const ROW = {
    __typename: 'ActivitySuggestion',
    id: 's1',
    suggestedBy: 'friend@example.com',
    suggestedAt: '2026-03-01T00:00:00.000Z',
    activity: {
      __typename: 'Activity',
      id: 's1',
      name: 'Fort Funston',
      shortDescription: 'Bluffs',
      longDescription: null,
      category: 'scenic',
      location: { __typename: 'Location', city: 'San Francisco' },
      duration: 'Half Day',
      costTier: null,
      coverImage: '',
      allTrailsUrl: null,
      reservationUrl: null,
      menuUrl: null,
      notes: null,
    },
  };
  const answer = vi.fn(() => ({ data: { pendingSuggestions: [ROW] } }));
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MockedProvider, {
      mocks: [{ request: { query: PENDING_SUGGESTIONS }, result: answer }],
      children,
    });

  it("lists an owner's queue", async () => {
    const { result } = renderHook(() => usePendingSuggestions(true), { wrapper });
    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0]).toMatchObject({ id: 's1', suggestedBy: 'friend@example.com' });
  });

  it('asks for nothing, and has nothing, for anyone else', async () => {
    answer.mockClear();
    const { result } = renderHook(() => usePendingSuggestions(false), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(answer).not.toHaveBeenCalled();
    expect(result.current).toEqual([]);
  });
});
