import { describe, expect, it } from 'vitest';
import { render, screen } from '../test/render';
import { Explore } from './Explore';

// The Discover cache lives in localStorage, so it can hold anything an older
// build or a hand edit left there. The page reads it during its first render,
// outside any try, so a wrong shape used to throw into the root error boundary
// on every reload.
const CACHE_KEY = 'fogandfrontier.discover.v1';

const event = {
  name: 'Harbor Festival',
  dateText: 'Sat',
  endDate: '2999-01-01',
  location: 'Santa Cruz',
  blurb: 'Boats and music.',
  sourceUrl: 'https://example.com/fest',
};

describe('Explore page: cached suggestions', () => {
  it('renders a well-formed cache', () => {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        range: 'weekend',
        at: Date.now(),
        events: [event],
        sources: [{ uri: 'https://example.com', title: 'Example' }],
      }),
    );
    render(<Explore />);
    expect(screen.getByText('Harbor Festival')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
  });

  it.each([
    ['no events list', { range: 'weekend', at: 1, sources: [] }],
    ['a null event', { range: 'weekend', at: 1, events: [null], sources: [] }],
    [
      'an event missing its name',
      { range: 'weekend', at: 1, events: [{ ...event, name: 3 }], sources: [] },
    ],
    ['an unknown range', { range: 'month', at: 1, events: [event], sources: [] }],
    ['no sources list', { range: 'weekend', at: 1, events: [event] }],
    ['a bare null', null],
  ])('treats a cache with %s as no cache and drops it', (_label, cached) => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    render(<Explore />);
    expect(
      screen.getByText(/No events have been discovered/),
    ).toBeInTheDocument();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('drops a cache that is not JSON', () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    render(<Explore />);
    expect(
      screen.getByText(/No events have been discovered/),
    ).toBeInTheDocument();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});
