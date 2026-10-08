// The trips canary for the smoke gate (#58). It can't read trips without a
// signed-in token, so it checks the next best thing, anonymously: the trips
// query still parses and validates against the deployed schema, its resolver
// runs and refuses with UNAUTHENTICATED, and nothing leaks to a caller with no
// token. A schema change that drops `trips`, a resolver that crashes or an
// auth gate that lets an anonymous caller read trips all fail the gate.

export const TRIPS_QUERY = '{ trips { id title } }';

/**
 * Judges the trips canary's response.
 * @param {{ status: number, contentType: string, payload: unknown }} res
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeTripsCanary({ status, contentType, payload }) {
  if (status !== 200) return { ok: false, detail: `expected 200, got ${status}` };
  if (!contentType.includes('application/json')) {
    return { ok: false, detail: `expected JSON, got ${contentType}` };
  }
  const body = /** @type {{ data?: { trips?: unknown } | null, errors?: Array<{ message?: string, extensions?: { code?: unknown } }> }} */ (
    payload ?? {}
  );
  if (body.data?.trips != null) {
    return { ok: false, detail: 'anonymous caller got trip data back' };
  }
  const errors = Array.isArray(body.errors) ? body.errors : [];
  const codes = errors.map((e) => e?.extensions?.code);
  if (errors.length > 0 && codes.every((c) => c === 'UNAUTHENTICATED')) {
    return { ok: true, detail: 'anonymous trips query refused with UNAUTHENTICATED' };
  }
  if (errors.length === 0) {
    return { ok: false, detail: 'no UNAUTHENTICATED error for an anonymous caller' };
  }
  const summary = errors
    .map((e) => `${String(e?.extensions?.code ?? 'no code')}: ${e?.message ?? ''}`)
    .join('; ')
    .slice(0, 300);
  return { ok: false, detail: `unexpected errors: ${summary}` };
}
