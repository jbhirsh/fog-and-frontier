import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { linkResult, linkReturnURL, withoutLinkResult } from './accountLinks';

// The address a linking comes back to is the browser's to hand over, and
// anyone's to make up: whatever its query, reading it never throws, names
// only Google or Apple, and tidying it leaves no linking marks; and what
// linkReturnURL writes, linkResult reads back.

const queries = fc
  .array(fc.tuple(fc.constantFrom('account', 'provider', 'error', 'view', 'q'), fc.string()), {
    maxLength: 6,
  })
  .map((pairs) => `?${new URLSearchParams(pairs).toString()}`);

describe('linkResult', () => {
  it('never throws, and names only Google or Apple', () => {
    fc.assert(
      fc.property(fc.oneof(queries, fc.string()), (search) => {
        const result = linkResult(search);
        if (result) expect(['google', 'apple']).toContain(result.provider);
      }),
    );
  });

  it('reads back what linkReturnURL wrote', () => {
    fc.assert(
      fc.property(
        queries,
        fc.constantFrom('google' as const, 'apple' as const),
        fc.constantFrom('linked' as const, 'link-failed' as const),
        (search, provider, outcome) => {
          const back = new URL(linkReturnURL(`https://example.com/p${search}`, provider, outcome));
          expect(linkResult(back.search)).toMatchObject({ provider, linked: outcome === 'linked' });
        },
      ),
    );
  });
});

describe('withoutLinkResult', () => {
  it('leaves nothing a linking added, and the rest as it was', () => {
    fc.assert(
      fc.property(queries, (search) => {
        const tidied = new URLSearchParams(withoutLinkResult(search));
        for (const name of ['account', 'provider', 'error', 'error_description']) {
          expect(tidied.has(name)).toBe(false);
        }
        const kept = [...new URLSearchParams(search)].filter(
          ([name]) => name === 'view' || name === 'q',
        );
        expect([...tidied]).toEqual(kept);
      }),
    );
  });
});
