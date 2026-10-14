import { describe, expect, it } from 'vitest';
import { REGION_LABELS, categoryOptionLabel, sentenceCase } from './activityLabels';

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

describe('REGION_LABELS', () => {
  it('names every region in words, not its slug', () => {
    expect(REGION_LABELS).toEqual({
      sf: 'San Francisco',
      'north-bay': 'North Bay',
      'east-bay': 'East Bay',
      'south-bay': 'South Bay',
      peninsula: 'Peninsula',
      'central-coast': 'Central Coast',
      norcal: 'NorCal',
      socal: 'SoCal',
      oregon: 'Oregon',
      washington: 'Washington',
    });
  });
});
