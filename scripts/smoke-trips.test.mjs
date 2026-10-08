import { describe, expect, it } from 'vitest';
import { judgeTripsCanary, TRIPS_QUERY } from './smoke-trips.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';
const refused = {
  data: null,
  errors: [{ message: 'unauthorized', extensions: { code: 'UNAUTHENTICATED' } }],
};

describe('judgeTripsCanary', () => {
  it('asks for the fields the trips list renders', () => {
    expect(TRIPS_QUERY).toBe('{ trips { id title } }');
  });

  it('passes an anonymous query refused with UNAUTHENTICATED', () => {
    expect(judgeTripsCanary({ status: 200, contentType: JSON_TYPE, payload: refused })).toEqual({
      ok: true,
      detail: 'anonymous trips query refused with UNAUTHENTICATED',
    });
  });

  it('fails a non-200, naming the status', () => {
    expect(judgeTripsCanary({ status: 500, contentType: JSON_TYPE, payload: refused })).toEqual({
      ok: false,
      detail: 'expected 200, got 500',
    });
    // A schema without `trips` fails validation with a 400.
    expect(judgeTripsCanary({ status: 400, contentType: JSON_TYPE, payload: refused }).ok).toBe(
      false,
    );
  });

  it('fails a response that is not JSON', () => {
    expect(
      judgeTripsCanary({ status: 200, contentType: 'text/html', payload: refused }),
    ).toEqual({ ok: false, detail: 'expected JSON, got text/html' });
  });

  it('fails when an anonymous caller gets trips back, even alongside an error', () => {
    for (const trips of [[], [{ id: 't1', title: 'Big Sur' }]]) {
      expect(
        judgeTripsCanary({
          status: 200,
          contentType: JSON_TYPE,
          payload: { ...refused, data: { trips } },
        }),
      ).toEqual({ ok: false, detail: 'anonymous caller got trip data back' });
    }
  });

  it('fails when nothing refused the anonymous caller', () => {
    for (const payload of [{ data: null }, {}, null, { errors: [] }, { errors: 'x' }]) {
      expect(judgeTripsCanary({ status: 200, contentType: JSON_TYPE, payload })).toEqual({
        ok: false,
        detail: 'no UNAUTHENTICATED error for an anonymous caller',
      });
    }
  });

  it('fails any other error, naming its code and message', () => {
    const crashed = {
      data: null,
      errors: [
        { message: 'unauthorized', extensions: { code: 'UNAUTHENTICATED' } },
        { message: 'no such table: trips', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
        { message: 'boom' },
      ],
    };
    expect(judgeTripsCanary({ status: 200, contentType: JSON_TYPE, payload: crashed })).toEqual({
      ok: false,
      detail:
        'unexpected errors: UNAUTHENTICATED: unauthorized; INTERNAL_SERVER_ERROR: no such table: trips; no code: boom',
    });
  });

  it('caps a long error summary', () => {
    const long = { errors: [{ message: 'x'.repeat(500), extensions: { code: 'BAD' } }] };
    const { detail } = judgeTripsCanary({ status: 200, contentType: JSON_TYPE, payload: long });
    expect(detail).toBe(`unexpected errors: ${`BAD: ${'x'.repeat(500)}`.slice(0, 300)}`);
  });
});
