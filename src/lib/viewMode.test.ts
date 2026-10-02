import { describe, expect, it } from 'vitest';
import { isViewMode } from './viewMode';

describe('isViewMode', () => {
  it.each(['list', 'split', 'map'])('accepts %s', (value) => {
    expect(isViewMode(value)).toBe(true);
  });

  it.each([null, undefined, '', 'grid', 'List', ' map'])(
    'rejects %j',
    (value) => {
      expect(isViewMode(value)).toBe(false);
    },
  );
});
