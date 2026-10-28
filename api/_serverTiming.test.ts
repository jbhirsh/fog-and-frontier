import { describe, expect, it } from 'vitest';
import { serverTimingHeader } from './_serverTiming';

describe('serverTimingHeader', () => {
  it('names each phase with its duration, to a tenth of a millisecond', () => {
    expect(serverTimingHeader({ schemaMs: 0, authMs: 41.26, execMs: 180.04 })).toBe(
      'schema;dur=0.0;desc="Schema setup", auth;dur=41.3;desc="Sign-in check", exec;dur=180.0;desc="Operation"',
    );
  });
});
