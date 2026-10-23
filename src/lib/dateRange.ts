/**
 * A trip's dates for display, e.g. "Mar 3 – Mar 5, 2026", with the start's
 * year shown only when it differs from the end's. Dates are YYYY-MM-DD and
 * read in UTC, so the day never shifts with the viewer's time zone; one that
 * doesn't parse is shown as given.
 */
export function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return `${start} – ${end}`;
  }
  const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
  const startFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
  const endFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${startFmt.format(startDate)} – ${endFmt.format(endDate)}`;
}
