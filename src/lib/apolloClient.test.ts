import { afterEach, describe, expect, it, vi } from 'vitest';
import { apolloClient } from './apolloClient';
import { COMPLETED_QUERY } from './gqlDocs';

afterEach(async () => {
  vi.unstubAllGlobals();
  await apolloClient.clearStore();
});

function stubFetch() {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: { completed: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Record<string, string> {
  const init = fetchMock.mock.calls[0]?.[1];
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('apolloClient', () => {
  // Vercel's edge compresses application/json but not
  // application/graphql-response+json, which Apollo Client asks for first by
  // default; asking for it sent the catalog uncompressed.
  it('asks for plain JSON, which the edge compresses', async () => {
    const fetchMock = stubFetch();
    await apolloClient.query({ query: COMPLETED_QUERY, fetchPolicy: 'network-only' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/graphql');
    expect(sentHeaders(fetchMock).accept).toBe('application/json');
  });

  // The session is a cookie on this origin, which only goes with the
  // request when credentials are on for it.
  it('sends the session cookie with each request', async () => {
    const fetchMock = stubFetch();
    await apolloClient.query({ query: COMPLETED_QUERY, fetchPolicy: 'network-only' });
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe('same-origin');
  });

  it('sends no Authorization header: the cookie is the sign-in', async () => {
    const fetchMock = stubFetch();
    await apolloClient.query({ query: COMPLETED_QUERY, fetchPolicy: 'network-only' });
    expect(sentHeaders(fetchMock)).not.toHaveProperty('authorization');
  });
});
