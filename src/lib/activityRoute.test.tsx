import { describe, expect, it } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  type InitialEntry,
  type Location,
} from 'react-router-dom';
import {
  ACTIVITY_PATH,
  CATALOG_LOCATION,
  activityPath,
  backgroundFor,
  isActivityPath,
  readActivityState,
  useCloseActivity,
  useOpenActivity,
} from './activityRoute';

function loc(pathname: string, state: unknown = null): Location {
  return { pathname, search: '', hash: '', state, key: 'k' };
}

const TRIPS = loc('/trips/t1');

describe('activityPath', () => {
  it('is /activity/<id>, with the id escaped', () => {
    expect(ACTIVITY_PATH).toBe('/activity/:id');
    expect(activityPath('muir-woods')).toBe('/activity/muir-woods');
    expect(activityPath('a/b c')).toBe('/activity/a%2Fb%20c');
  });
});

describe('isActivityPath', () => {
  it.each([
    ['/activity/muir', true],
    ['/activity/muir/', true],
    ['/activity', false],
    ['/activity/muir/more', false],
    ['/trips/t1', false],
    ['/', false],
  ])('%s → %s', (pathname, want) => {
    expect(isActivityPath(pathname)).toBe(want);
  });
});

describe('readActivityState', () => {
  it('reads a background page and depth', () => {
    expect(readActivityState({ backgroundLocation: TRIPS, depth: 2 })).toEqual({
      backgroundLocation: TRIPS,
      depth: 2,
      cold: false,
    });
  });

  it('reads cold only when it is true', () => {
    const base = { backgroundLocation: TRIPS, depth: 1 };
    expect(readActivityState({ ...base, cold: true })?.cold).toBe(true);
    expect(readActivityState({ ...base, cold: 'yes' })?.cold).toBe(false);
  });

  it.each([
    ['nothing', null],
    ['a string', 'state'],
    ['no background', { depth: 1 }],
    ['a null background', { backgroundLocation: null, depth: 1 }],
    ['a background that is not an object', { backgroundLocation: '/', depth: 1 }],
    ['a background without a path', { backgroundLocation: { pathname: 3 }, depth: 1 }],
    ['no depth', { backgroundLocation: TRIPS }],
    ['a depth that is not a number', { backgroundLocation: TRIPS, depth: '1' }],
  ])('ignores %s', (_, state) => {
    expect(readActivityState(state)).toBeNull();
  });
});

describe('backgroundFor', () => {
  it('is the page an activity was opened over', () => {
    expect(
      backgroundFor(loc('/activity/muir', { backgroundLocation: TRIPS, depth: 1 })),
    ).toBe(TRIPS);
  });

  it('is the catalog for an activity opened from a link', () => {
    expect(backgroundFor(loc('/activity/muir'))).toBe(CATALOG_LOCATION);
    expect(CATALOG_LOCATION).toMatchObject({ pathname: '/', search: '', hash: '' });
  });

  it('is nothing on any other page', () => {
    expect(backgroundFor(loc('/trips/t1'))).toBeNull();
    expect(backgroundFor(loc('/'))).toBeNull();
  });
});

function Harness() {
  const location = useLocation();
  const open = useOpenActivity();
  const close = useCloseActivity();
  // The close from the first render, to call after the entry has moved on.
  const [firstClose] = useState(() => close);
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="url">{location.pathname + location.search}</output>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      <button type="button" onClick={() => open('muir')}>
        open muir
      </button>
      <button type="button" onClick={() => open('tam')}>
        open tam
      </button>
      <button type="button" onClick={close}>
        close
      </button>
      <button type="button" onClick={() => void navigate(-1)}>
        back
      </button>
      <button type="button" onClick={() => void navigate(1)}>
        forward
      </button>
      <button
        type="button"
        onClick={() => {
          close();
          close();
        }}
      >
        close twice
      </button>
      <button type="button" onClick={firstClose}>
        stale close
      </button>
    </>
  );
}

function renderAt(...entries: InitialEntry[]) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Harness />
    </MemoryRouter>,
  );
}

function url() {
  return screen.getByTestId('url').textContent;
}

function state() {
  return JSON.parse(screen.getByTestId('state').textContent ?? 'null') as unknown;
}

describe('useOpenActivity', () => {
  it('opens over the current page', async () => {
    renderAt('/?q=tide');
    await userEvent.click(screen.getByRole('button', { name: 'open muir' }));
    expect(url()).toBe('/activity/muir');
    expect(state()).toMatchObject({
      backgroundLocation: { pathname: '/', search: '?q=tide' },
      depth: 1,
    });
    expect(state()).not.toHaveProperty('cold');
  });

  it('opens a nearby activity one deeper over the same page', async () => {
    renderAt('/trips/t1');
    await userEvent.click(screen.getByRole('button', { name: 'open muir' }));
    await userEvent.click(screen.getByRole('button', { name: 'open tam' }));
    expect(url()).toBe('/activity/tam');
    expect(state()).toMatchObject({
      backgroundLocation: { pathname: '/trips/t1' },
      depth: 2,
      cold: false,
    });
  });

  it('opens over the catalog from an activity reached by a link', async () => {
    renderAt('/activity/muir');
    await userEvent.click(screen.getByRole('button', { name: 'open tam' }));
    expect(url()).toBe('/activity/tam');
    expect(state()).toEqual({
      backgroundLocation: CATALOG_LOCATION,
      depth: 1,
      cold: true,
    });
  });
});

describe('useCloseActivity', () => {
  it('steps back past every activity opened in a row', async () => {
    renderAt('/trips/t1');
    await userEvent.click(screen.getByRole('button', { name: 'open muir' }));
    await userEvent.click(screen.getByRole('button', { name: 'open tam' }));
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(url()).toBe('/trips/t1');
  });

  it('replaces an activity reached by a link with the catalog', async () => {
    renderAt('/trips/t1', '/activity/muir');
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(url()).toBe('/');
    expect(state()).toBeNull();
    // Replaced, so Back doesn't reopen it.
    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(url()).toBe('/trips/t1');
  });

  it('goes to the catalog from a nearby activity opened after a link', async () => {
    renderAt('/trips/t1', '/activity/muir');
    await userEvent.click(screen.getByRole('button', { name: 'open tam' }));
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(url()).toBe('/');
  });

  it('steps back only once for a close repeated before the router catches up', async () => {
    renderAt('/x', '/trips/t1');
    await userEvent.click(screen.getByRole('button', { name: 'open muir' }));
    await userEvent.click(screen.getByRole('button', { name: 'open tam' }));
    await userEvent.click(screen.getByRole('button', { name: 'close twice' }));
    expect(url()).toBe('/trips/t1');
  });

  it('replaces only once for a repeated close of a link', async () => {
    renderAt('/x', '/activity/muir');
    await userEvent.click(screen.getByRole('button', { name: 'close twice' }));
    expect(url()).toBe('/');
    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(url()).toBe('/x');
  });

  it('ignores a close from an entry the history has moved past', async () => {
    renderAt('/x', '/activity/muir');
    await userEvent.click(screen.getByRole('button', { name: 'open tam' }));
    await userEvent.click(screen.getByRole('button', { name: 'stale close' }));
    expect(url()).toBe('/activity/tam');
  });

  it('closes again after Forward returns to an entry it closed', async () => {
    renderAt('/trips/t1');
    await userEvent.click(screen.getByRole('button', { name: 'open muir' }));
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(url()).toBe('/trips/t1');
    await userEvent.click(screen.getByRole('button', { name: 'forward' }));
    expect(url()).toBe('/activity/muir');
    await userEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(url()).toBe('/trips/t1');
  });

  it('ignores a close kept past its page unmounting', async () => {
    function Closer({ onReady }: { onReady: (close: () => void) => void }) {
      const close = useCloseActivity();
      useEffect(() => onReady(close), [close, onReady]);
      return null;
    }
    function Keeper() {
      const location = useLocation();
      const [kept, setKept] = useState<{ close: () => void } | null>(null);
      const [shown, setShown] = useState(true);
      const [onReady] = useState(() => (close: () => void) => setKept({ close }));
      return (
        <>
          {shown && <Closer onReady={onReady} />}
          <output data-testid="url">{location.pathname}</output>
          <button type="button" onClick={() => setShown(false)}>
            unmount
          </button>
          <button type="button" onClick={() => kept?.close()}>
            kept close
          </button>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={['/activity/muir']}>
        <Keeper />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'unmount' }));
    await userEvent.click(screen.getByRole('button', { name: 'kept close' }));
    expect(url()).toBe('/activity/muir');
  });
});
