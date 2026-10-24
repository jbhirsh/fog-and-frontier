import { describe, expect, it } from 'vitest';
import { categoryOptionLabel, sentenceCase } from './activityLabels';

describe('sentenceCase', () => {
  it('capitalises the first letter only', () => {
    expect(sentenceCase('hiking')).toBe('Hiking');
    expect(sentenceCase('half day trip')).toBe('Half day trip');
  });

  it('leaves an empty value empty', () => {
    expect(sentenceCase('')).toBe('');
  });
});

describe('categoryOptionLabel', () => {
  it('reads "Any category", lower case after the first word', () => {
    expect(categoryOptionLabel('Any')).toBe('Any category');
  });

  it('capitalises each category', () => {
    expect(categoryOptionLabel('hiking')).toBe('Hiking');
    expect(categoryOptionLabel('climbing')).toBe('Climbing');
  });
});
