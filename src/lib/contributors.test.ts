import { describe, expect, it } from 'vitest';
import { contributorsLabel } from './contributors';

describe('contributorsLabel', () => {
  it('is null when there is no one to credit', () => {
    expect(contributorsLabel(undefined)).toBeNull();
    expect(contributorsLabel([])).toBeNull();
  });

  it('names one or two contributors', () => {
    expect(contributorsLabel(['tarun@example.com'])).toBe('Tarun');
    expect(contributorsLabel(['tarun@example.com', 'jess.hirsh@example.com'])).toBe(
      'Tarun, Jess Hirsh',
    );
  });

  it('names the first two and counts the rest', () => {
    expect(contributorsLabel(['a@example.com', 'b@example.com', 'c@example.com'])).toBe('A, B +1');
    expect(contributorsLabel(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'])).toBe('A, B +2');
  });
});
