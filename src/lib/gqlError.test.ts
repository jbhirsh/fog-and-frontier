import { describe, expect, it } from 'vitest';
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import type { GraphQLFormattedError } from 'graphql';
import { appCodeOf, errorCodeOf, gqlErrorInfo, tripLoadErrorFrom } from './gqlError';

// A resolver error as Apollo surfaces it: HTTP 200 with `errors[]`.
function graphqlErrors(...errors: GraphQLFormattedError[]): CombinedGraphQLErrors {
  return new CombinedGraphQLErrors({ errors });
}

function coded(code: unknown, appCode?: unknown): CombinedGraphQLErrors {
  return graphqlErrors({ message: 'nope', extensions: { code, appCode } });
}

describe('gqlErrorInfo', () => {
  it('reads code, appCode and message from the first GraphQL error', () => {
    const error = graphqlErrors(
      { message: 'trip is past', extensions: { code: 'CONFLICT', appCode: 'trip_past' } },
      { message: 'second', extensions: { code: 'INTERNAL', appCode: 'duplicate' } },
    );
    expect(gqlErrorInfo(error)).toEqual({
      code: 'CONFLICT',
      appCode: 'trip_past',
      message: 'trip is past',
    });
  });

  it('gives null codes when the first error has no extensions', () => {
    expect(gqlErrorInfo(graphqlErrors({ message: 'plain' }))).toEqual({
      code: null,
      appCode: null,
      message: 'plain',
    });
  });

  it('ignores extension codes that are not strings', () => {
    expect(gqlErrorInfo(coded(404, { name: 'x' }))).toEqual({
      code: null,
      appCode: null,
      message: 'nope',
    });
  });

  it('falls back to the combined message when the errors list is empty', () => {
    const error = graphqlErrors();
    error.message = 'combined';
    expect(gqlErrorInfo(error)).toEqual({ code: null, appCode: null, message: 'combined' });
  });

  it('maps a network Error to null codes with its message', () => {
    expect(gqlErrorInfo(new Error('Failed to fetch'))).toEqual({
      code: null,
      appCode: null,
      message: 'Failed to fetch',
    });
  });

  it('gives a generic message for a thrown non-Error', () => {
    expect(gqlErrorInfo('boom')).toEqual({ code: null, appCode: null, message: 'Request failed' });
    expect(gqlErrorInfo({ errors: [{ message: 'not combined' }] })).toEqual({
      code: null,
      appCode: null,
      message: 'Request failed',
    });
  });
});

describe('appCodeOf', () => {
  it('returns the appCode extension', () => {
    expect(appCodeOf(coded('CONFLICT', 'duplicate'))).toBe('duplicate');
  });

  it('returns null without one, and for network errors', () => {
    expect(appCodeOf(coded('CONFLICT'))).toBeNull();
    expect(appCodeOf(new Error('offline'))).toBeNull();
  });
});

describe('errorCodeOf', () => {
  it('returns the code extension', () => {
    expect(errorCodeOf(coded('FORBIDDEN', 'not_adder'))).toBe('FORBIDDEN');
  });

  it('returns null for network errors', () => {
    expect(errorCodeOf(new Error('offline'))).toBeNull();
  });
});

describe('tripLoadErrorFrom', () => {
  it('maps UNAUTHENTICATED to unauthorized', () => {
    expect(tripLoadErrorFrom(coded('UNAUTHENTICATED'))).toBe('unauthorized');
  });

  it('maps NOT_FOUND to not-found', () => {
    expect(tripLoadErrorFrom(coded('NOT_FOUND'))).toBe('not-found');
  });

  it('maps every other error to failed', () => {
    expect(tripLoadErrorFrom(coded('FORBIDDEN'))).toBe('failed');
    expect(tripLoadErrorFrom(new Error('offline'))).toBe('failed');
  });
});
