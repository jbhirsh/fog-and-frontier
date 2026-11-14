import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fireEvent, render, screen } from '../test/render';
import { apolloClient } from '../lib/apolloClient';
import { getIcon } from '../test/icons';
import { Explore } from './Explore';

// The Discover cache lives in localStorage, so it can hold anything an older
// build or a hand edit left there. The page reads it during its first render,
// outside any try, so a wrong shape used to throw into the root error boundary
// on every reload.
const CACHE_KEY = 'fogandfrontier.discover.v1';

// Local noon on 5 March: todayISO() reads '2026-03-05', its month and day both
// zero-padded.
const NOW = new Date(2026, 2, 5, 12, 0, 0).getTime();

type ForceOwner = { __TEST_FORCE_OWNER__?: boolean };

const event = {
  name: 'Harbor Festival',
  dateText: 'Sat',
  endDate: '2999-01-01',
  location: 'Santa Cruz',
  blurb: 'Boats and music.',
  sourceUrl: 'https://example.com/fest',
};

function seedCache(cache: Record<string, unknown>) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ range: 'weekend', at: NOW, events: [event], sources: [], ...cache }),
  );
}

function storedCache(): unknown {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

// The live model's rows, every field nullable, as DISCOVER_QUERY returns them.
type DiscoverRow = {
  name?: string | null;
  dateText?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  blurb?: string | null;
  sourceUrl?: string | null;
};

function discoverResult(
  events: DiscoverRow[] | null,
  sources: { uri: string | null; title: string | null }[] | null = [],
) {
  return { data: { discover: { range: 'weekend', events, sources } } };
}

// apolloClient.query is generic; its stand-in answers with whatever the test
// gives, as the network would.
function mockQuery() {
  return vi.spyOn(apolloClient, 'query') as unknown as MockInstance<
    (options: unknown) => Promise<unknown>
  >;
}

function discoverButton() {
  return screen.getByRole('button', { name: /Discover events|Refresh|Searching/ });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as ForceOwner).__TEST_FORCE_OWNER__;
});

describe('Explore page: cached suggestions', () => {
  it('renders a well-formed cache with its sources and when it was fetched', () => {
    seedCache({
      at: NOW - 30_500,
      sources: [
        { uri: 'https://example.com', title: 'Example' },
        { uri: 'https://untitled.example.com', title: '' },
      ],
    });
    render(<Explore />);
    expect(screen.getByText('Harbor Festival')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
    expect(screen.getByText('Santa Cruz')).toBeInTheDocument();
    expect(screen.getByText('Boats and music.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Harbor Festival/ })).toHaveAttribute(
      'href',
      'https://example.com/fest',
    );
    expect(screen.getByText('Sources Gemini searched')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Example' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
    // A source without a title shows its address.
    expect(screen.getByRole('link', { name: 'https://untitled.example.com' })).toBeInTheDocument();
    expect(screen.getByText('Last refreshed 30s ago for This weekend')).toBeInTheDocument();
    expect(screen.getByText(/AI-generated suggestions/)).toBeInTheDocument();
    expect(screen.queryByText(/No events have been discovered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing surfaced/)).not.toBeInTheDocument();
  });

  it('restores the cached range as the selected one', () => {
    seedCache({ range: 'tomorrow' });
    render(<Explore />);
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'This weekend' })).not.toHaveClass('bg-primary');
    expect(screen.getByText(/for Tomorrow$/)).toBeInTheDocument();
  });

  it('hides the sources list when the cache has none', () => {
    seedCache({});
    render(<Explore />);
    expect(screen.getByText('Harbor Festival')).toBeInTheDocument();
    expect(screen.queryByText('Sources Gemini searched')).not.toBeInTheDocument();
  });

  it.each([
    [59_999, '59s ago'],
    [60_000, '1m ago'],
    [90_000, '1m ago'],
    [3_599_999, '59m ago'],
    [3_600_000, '1h ago'],
    [5_400_000, '1h ago'],
  ])('says a cache fetched %ims ago was refreshed %s', (age, label) => {
    seedCache({ at: NOW - age });
    render(<Explore />);
    expect(screen.getByText(`Last refreshed ${label} for This weekend`)).toBeInTheDocument();
  });

  it('keeps events ending today or later, or undated, and drops the rest from storage', () => {
    seedCache({
      events: [
        { ...event, name: 'Ends today', endDate: '2026-03-05' },
        { ...event, name: 'Ended yesterday', endDate: '2026-03-04' },
        { ...event, name: 'Started yesterday', endDate: undefined, startDate: '2026-03-04' },
        { ...event, name: 'Starts today', endDate: undefined, startDate: '2026-03-05' },
        { ...event, name: 'Ends later', startDate: '2026-03-01', endDate: '2026-03-06' },
        { ...event, name: 'Undated', endDate: undefined },
      ],
    });
    render(<Explore />);
    expect(screen.getByText('Ends today')).toBeInTheDocument();
    expect(screen.getByText('Starts today')).toBeInTheDocument();
    expect(screen.getByText('Ends later')).toBeInTheDocument();
    expect(screen.getByText('Undated')).toBeInTheDocument();
    expect(screen.queryByText('Ended yesterday')).not.toBeInTheDocument();
    expect(screen.queryByText('Started yesterday')).not.toBeInTheDocument();
    const stored = storedCache() as { events: { name: string }[]; at: number; range: string };
    expect(stored.events.map((e) => e.name)).toEqual([
      'Ends today',
      'Starts today',
      'Ends later',
      'Undated',
    ]);
    expect(stored.at).toBe(NOW);
    expect(stored.range).toBe('weekend');
  });

  it('leaves a cache with nothing past untouched', () => {
    seedCache({});
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    render(<Explore />);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('reads no cache, and removes nothing, when none is stored', () => {
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    render(<Explore />);
    expect(screen.getByText(/No events have been discovered/)).toBeInTheDocument();
    expect(removeItem).not.toHaveBeenCalled();
    expect(screen.queryByText(/Last refreshed/)).not.toBeInTheDocument();
  });

  it('drops a cache whose events have all passed', () => {
    seedCache({ events: [{ ...event, endDate: '2026-03-04' }] });
    render(<Explore />);
    expect(screen.getByText(/No events have been discovered/)).toBeInTheDocument();
    expect(screen.queryByText(/Last refreshed/)).not.toBeInTheDocument();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['no events list', { range: 'weekend', at: 1, sources: [] }],
    ['an events object', { range: 'weekend', at: 1, events: {}, sources: [] }],
    ['a null event', { range: 'weekend', at: 1, events: [null], sources: [] }],
    ['an event that is a list', { range: 'weekend', at: 1, events: [[]], sources: [] }],
    ...['name', 'dateText', 'startDate', 'endDate', 'location', 'blurb', 'sourceUrl'].map(
      (field): [string, unknown] => [
        `an event whose ${field} is not text`,
        { range: 'weekend', at: 1, events: [{ ...event, [field]: 3 }], sources: [] },
      ],
    ),
    [
      'one bad event among good ones',
      { range: 'weekend', at: 1, events: [event, { ...event, name: 3 }], sources: [] },
    ],
    [
      'one bad source among good ones',
      {
        range: 'weekend',
        at: 1,
        events: [event],
        sources: [{ uri: 'https://x', title: 'x' }, null],
      },
    ],
    ['an unknown range', { range: 'month', at: 1, events: [event], sources: [] }],
    ['a range that is not text', { range: 7, at: 1, events: [event], sources: [] }],
    ['a time that is not a number', { range: 'weekend', at: '1', events: [event], sources: [] }],
    ['no sources list', { range: 'weekend', at: 1, events: [event] }],
    ['a sources object', { range: 'weekend', at: 1, events: [event], sources: {} }],
    ['a null source', { range: 'weekend', at: 1, events: [event], sources: [null] }],
    [
      'a source whose address is not text',
      { range: 'weekend', at: 1, events: [event], sources: [{ uri: 1, title: 'x' }] },
    ],
    [
      'a source whose title is not text',
      { range: 'weekend', at: 1, events: [event], sources: [{ uri: 'https://x', title: 1 }] },
    ],
    ['a list', [event]],
    ['a bare null', null],
  ])('treats a cache with %s as no cache and drops it', (_label, cached) => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    render(<Explore />);
    expect(screen.getByText(/No events have been discovered/)).toBeInTheDocument();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('drops a cache whose time is not finite', () => {
    localStorage.setItem(
      CACHE_KEY,
      `{"range":"weekend","at":1e999,"events":${JSON.stringify([event])},"sources":[]}`,
    );
    render(<Explore />);
    expect(screen.getByText(/No events have been discovered/)).toBeInTheDocument();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('drops a cache that is not JSON', () => {
    localStorage.setItem(CACHE_KEY, '{not json');
    render(<Explore />);
    expect(screen.getByText(/No events have been discovered/)).toBeInTheDocument();
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it('renders without a cache when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    render(<Explore />);
    expect(screen.getByText(/No events have been discovered/)).toBeInTheDocument();
  });
});

describe('Explore page: signed-out visitors and members', () => {
  it('offers the ranges but no search', () => {
    render(<Explore />);
    expect(screen.getByRole('button', { name: 'This weekend' })).toHaveClass('bg-primary');
    expect(screen.queryByRole('button', { name: /Discover events/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/tap/)).not.toBeInTheDocument();
    expect(getIcon('explore')).toHaveStyle({ fontSize: '64px' });
  });
});

describe('Explore page: an owner discovering events', () => {
  beforeEach(() => {
    (window as ForceOwner).__TEST_FORCE_OWNER__ = true;
  });

  it('invites a first search', () => {
    render(<Explore />);
    expect(discoverButton()).toHaveTextContent('Discover events');
    expect(screen.getByText(/to see what's happening/)).toBeInTheDocument();
    expect(screen.queryByText(/No events have been discovered/)).not.toBeInTheDocument();
  });

  it('searches the chosen range, shows the results and caches them', async () => {
    const query = mockQuery().mockResolvedValue(
      discoverResult(
        [
          {
            name: 'Tide Pools',
            dateText: 'Today',
            startDate: '2026-03-05',
            endDate: null,
            location: 'Pacifica',
            blurb: 'Low tide.',
            sourceUrl: 'https://example.com/tide',
          },
        ],
        [{ uri: 'https://example.com', title: 'Example' }],
      ),
    );
    render(<Explore />);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('button', { name: 'Today' })).toHaveClass('bg-primary');
    expect(screen.getByRole('button', { name: 'This weekend' })).not.toHaveClass('bg-primary');
    fireEvent.click(discoverButton());

    expect(await screen.findByText('Tide Pools')).toBeInTheDocument();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      variables: { range: 'today' },
      fetchPolicy: 'network-only',
    });
    expect(screen.getByRole('link', { name: 'Example' })).toBeInTheDocument();
    expect(screen.getByText('Last refreshed 0s ago for Today')).toBeInTheDocument();
    expect(discoverButton()).toHaveTextContent('Refresh');
    expect(storedCache()).toEqual({
      range: 'today',
      at: NOW,
      events: [
        {
          name: 'Tide Pools',
          dateText: 'Today',
          startDate: '2026-03-05',
          location: 'Pacifica',
          blurb: 'Low tide.',
          sourceUrl: 'https://example.com/tide',
        },
      ],
      sources: [{ uri: 'https://example.com', title: 'Example' }],
    });
  });

  it('fills the fields the model left empty, so the cache reads back', async () => {
    mockQuery().mockResolvedValue(
      discoverResult(
        [
          {
            name: null,
            dateText: null,
            startDate: null,
            endDate: '2026-03-06',
            location: null,
            blurb: null,
            sourceUrl: null,
          },
        ],
        [{ uri: null, title: null }],
      ),
    );
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText('View source')).toBeInTheDocument();
    expect(storedCache()).toEqual({
      range: 'weekend',
      at: NOW,
      events: [
        {
          name: '',
          dateText: '',
          endDate: '2026-03-06',
          location: '',
          blurb: '',
          sourceUrl: '',
        },
      ],
      sources: [{ uri: '', title: '' }],
    });
  });

  it('lists at most twelve sources', async () => {
    const sources = Array.from({ length: 13 }, (_, i) => ({
      uri: `https://s${i}.example.com`,
      title: `Source ${i}`,
    }));
    mockQuery().mockResolvedValue(discoverResult([{ ...event, endDate: null }], sources));
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText('Source 11')).toBeInTheDocument();
    expect(screen.queryByText('Source 12')).not.toBeInTheDocument();
  });

  it('says when nothing surfaced', async () => {
    mockQuery().mockResolvedValue(discoverResult([]));
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText(/Nothing surfaced for that window/)).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated suggestions/)).not.toBeInTheDocument();
    expect(screen.queryByText(/to see what's happening/)).not.toBeInTheDocument();
  });

  it('hides "nothing surfaced" while searching again and when that fails', async () => {
    let reject: (e: Error) => void = () => {};
    mockQuery()
      .mockResolvedValueOnce(discoverResult([]))
      .mockReturnValueOnce(
        new Promise((_resolve, r) => {
          reject = r;
        }),
      );
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText(/Nothing surfaced for that window/)).toBeInTheDocument();

    fireEvent.click(discoverButton());
    expect(screen.getByText('Searching the web for upcoming events…')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing surfaced/)).not.toBeInTheDocument();

    reject(new Error('down'));
    expect(await screen.findByText('down')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing surfaced/)).not.toBeInTheDocument();
  });

  it('searches the next seven days', async () => {
    const query = mockQuery().mockResolvedValue(discoverResult([]));
    render(<Explore />);
    fireEvent.click(screen.getByRole('button', { name: 'Next 7 days' }));
    fireEvent.click(discoverButton());
    expect(await screen.findByText('Last refreshed 0s ago for Next 7 days')).toBeInTheDocument();
    expect(query.mock.calls[0]?.[0]).toMatchObject({ variables: { range: 'week' } });
  });

  it('hides the invitation while the first search runs', () => {
    mockQuery().mockReturnValue(new Promise(() => {}));
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(screen.getByText('Searching the web for upcoming events…')).toBeInTheDocument();
    expect(screen.queryByText(/to see what's happening/)).not.toBeInTheDocument();
  });

  it.each([
    ['no events or sources', { data: { discover: { events: null, sources: null } } }],
    ['no result', { data: { discover: null } }],
    ['no data', {}],
  ])('reads a response with %s as nothing surfaced', async (_label, response) => {
    mockQuery().mockResolvedValue(response);
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText(/Nothing surfaced for that window/)).toBeInTheDocument();
    expect(storedCache()).toEqual({ range: 'weekend', at: NOW, events: [], sources: [] });
  });

  it('shows the search in progress', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockQuery().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    seedCache({});
    render(<Explore />);
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument();
    fireEvent.click(discoverButton());

    expect(discoverButton()).toHaveTextContent('Searching…');
    expect(discoverButton()).toBeDisabled();
    expect(screen.getByText('Searching the web for upcoming events…')).toBeInTheDocument();
    expect(screen.queryByText('Harbor Festival')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last refreshed/)).not.toBeInTheDocument();

    resolve(discoverResult([{ ...event, name: 'Fresh', endDate: null }]));
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
    expect(discoverButton()).toBeEnabled();
    expect(screen.queryByText('Searching the web for upcoming events…')).not.toBeInTheDocument();
  });

  it('shows a failure in place of the results, and retries', async () => {
    const query = mockQuery()
      .mockRejectedValueOnce(new Error('Gemini is busy'))
      .mockResolvedValueOnce(discoverResult([{ ...event, name: 'Retried', endDate: null }]));
    seedCache({});
    render(<Explore />);
    fireEvent.click(discoverButton());

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByText('Gemini is busy')).toBeInTheDocument();
    expect(screen.queryByText('Harbor Festival')).not.toBeInTheDocument();
    expect(screen.queryByText(/to see what's happening/)).not.toBeInTheDocument();
    // The failed search left the cache as it was.
    expect((storedCache() as { events: { name: string }[] }).events[0]?.name).toBe(
      'Harbor Festival',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Retried')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong.')).not.toBeInTheDocument();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('describes a failure that is not an Error', async () => {
    mockQuery().mockRejectedValue('offline');
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText('Failed to load suggestions')).toBeInTheDocument();
    expect(screen.queryByText(/to see what's happening/)).not.toBeInTheDocument();
  });

  it('still shows the results when storage is full', async () => {
    mockQuery().mockResolvedValue(discoverResult([{ ...event, name: 'Unsaved', endDate: null }]));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    render(<Explore />);
    fireEvent.click(discoverButton());
    expect(await screen.findByText('Unsaved')).toBeInTheDocument();
  });
});
