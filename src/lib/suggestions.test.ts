import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Activity } from '../data/types';
import { apolloClient } from './apolloClient';
import { suggestUserActivity } from './suggestions';

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
      sent.push((JSON.parse(opts.body) as { variables: { input: Record<string, unknown> } }).variables);
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
