import { describe, expect, it } from 'vitest';
import { formatDateRange } from './dateRange';

describe('formatDateRange', () => {
  it('shows the year once when both dates share it', () => {
    expect(formatDateRange('2026-03-03', '2026-03-05')).toBe('Mar 3 – Mar 5, 2026');
  });

  it('shows both years when the trip crosses into the next', () => {
    expect(formatDateRange('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025 – Jan 2, 2026');
  });

  it('shows a one-day trip as the same day twice', () => {
    expect(formatDateRange('2026-07-04', '2026-07-04')).toBe('Jul 4 – Jul 4, 2026');
  });

  it('reads the dates in UTC, so the first and last of a month stay put', () => {
    expect(formatDateRange('2026-01-01', '2026-01-31')).toBe('Jan 1 – Jan 31, 2026');
  });

  it('shows dates that do not parse as given', () => {
    expect(formatDateRange('someday', '2026-01-02')).toBe('someday – 2026-01-02');
    expect(formatDateRange('2026-01-02', '')).toBe('2026-01-02 – ');
  });
});
