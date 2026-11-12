import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { failure } from './check-links.mjs';

// A failed request throws whatever fetch throws: these hold for any of it.
// Example tests are in check-links.test.mjs.
describe('failure, for anything thrown', () => {
  it('never throws, and always gives a reason', () => {
    fc.assert(
      fc.property(fc.anything(), (thrown) => {
        const result = failure(thrown);
        expect(Object.keys(result)).toEqual(['error']);
        expect(result.error).toBeTruthy();
      }),
    );
  });

  it('gives a string reason for any error-shaped throw, whatever its fields hold', () => {
    const field = fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.anything());
    const error = fc.record(
      {
        name: fc.string(),
        code: field,
        message: field,
        cause: fc.record({ code: field, message: field }, { requiredKeys: [] }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(error, (thrown) => {
        expect(typeof failure(thrown).error).toBe('string');
      }),
    );
  });

  it('calls only a TimeoutError a timeout', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (name, message) => {
        fc.pre(name !== 'TimeoutError' && message !== 'timeout');
        expect(failure({ name, message }).error).toBe(message || 'fetch failed');
      }),
    );
  });
});
