import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  CONTRIBUTORS_PARAM,
  parseContributors,
  readCompletedOnly,
  withCompletedOnly,
  withContributors,
} from './useCatalogFilters';

// The URL-synced filters (#9, "Completed only") read back what they wrote,
// whatever a shared link or a person typing in the address bar puts there.
// Example tests are in useCatalogFilters.test.ts.

// Query params other than the two filters, which every write must keep.
const otherParams = fc
  .dictionary(
    fc.string({ minLength: 1 }).filter((k) => k !== 'completed' && k !== CONTRIBUTORS_PARAM),
    fc.string(),
  )
  .map((entries) => new URLSearchParams(entries));

describe('?contributors=, for any value', () => {
  it('parses to trimmed, lower-cased, distinct, non-empty emails without commas', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), (raw) => {
        const emails = parseContributors(raw);
        expect(new Set(emails).size).toBe(emails.length);
        for (const email of emails) {
          expect(email).not.toBe('');
          expect(email).toBe(email.trim().toLowerCase());
          expect(email).not.toContain(',');
        }
      }),
    );
  });

  it('parses its own output to the same list', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = parseContributors(raw);
        expect(parseContributors(once.join(','))).toEqual(once);
      }),
    );
  });

  it('reads back the list it wrote, and keeps the other params', () => {
    fc.assert(
      fc.property(otherParams, fc.string(), (params, raw) => {
        const list = parseContributors(raw);
        const next = withContributors(params, list);
        expect(parseContributors(next.get(CONTRIBUTORS_PARAM))).toEqual(list);
        expect(next.has(CONTRIBUTORS_PARAM)).toBe(list.length > 0);
        next.delete(CONTRIBUTORS_PARAM);
        expect(next.toString()).toBe(params.toString());
      }),
    );
  });
});

describe('?completed=, for any params', () => {
  it('reads back what it wrote, keeps the other params and leaves the input alone', () => {
    fc.assert(
      fc.property(otherParams, fc.boolean(), (params, on) => {
        const before = params.toString();
        const next = withCompletedOnly(params, on);
        expect(readCompletedOnly(next)).toBe(on);
        expect(params.toString()).toBe(before);
        next.delete('completed');
        expect(next.toString()).toBe(before);
      }),
    );
  });
});
