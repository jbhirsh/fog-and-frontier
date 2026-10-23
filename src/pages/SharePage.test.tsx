import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { SharedPlace, SharedPlaces } from '../lib/sharedPlaces';

import { SharePage } from './SharePage';

// Sharing an Instagram post or reel to the app (#6): the page finds the
// post's places and adds them one at a time, through the usual Add dialog
// for owners only, and asks a signed-out visitor to sign in first.

const ownerState = vi.hoisted(() => ({
  isLoaded: true,
  email: 'owner@example.com',
  isOwner: true,
}));
vi.mock('../lib/useOwner', () => ({ useOwner: () => ownerState }));

const found = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../lib/sharedPlaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sharedPlaces')>()),
  findSharedPlaces: found.fn,
}));

// Clerk's sign-in, when the app has Clerk (it doesn't under test).
const clerk = vi.hoisted(() => ({ enabled: false }));
vi.mock('../lib/authShim', () => ({
  get CLERK_ENABLED() {
    return clerk.enabled;
  },
}));
vi.mock('@clerk/clerk-react', () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => <div data-testid="clerk-sign-in">{children}</div>,
}));

const opened = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('../lib/activityRoute', () => ({ useOpenActivity: () => opened.fn }));

// The Add dialog has its own tests: here it shows what it was seeded with, and
// lets a test save, open or close it.
vi.mock('../components/AddActivity', () => ({
  AddActivity: (props: {
    suggest?: boolean;
    seed?: { title: string; notes: string };
    source?: string;
    onClose: () => void;
    onSaved?: () => void;
    onOpenActivity?: (id: string) => void;
  }) => (
    <div role="dialog" aria-label={props.suggest ? 'Suggest an activity' : 'Add an activity'}>
      <p data-testid="seed-title">{props.seed?.title}</p>
      <p data-testid="seed-notes">{props.seed?.notes}</p>
      <p data-testid="source">{props.source}</p>
      <button type="button" onClick={props.onSaved}>
        Save it
      </button>
      <button type="button" onClick={() => props.onOpenActivity?.('dup-id')}>
        Open the duplicate
      </button>
      <button type="button" onClick={props.onClose}>
        Close it
      </button>
    </div>
  ),
}));

const REEL = 'https://www.instagram.com/reel/Ddl9QKSv0D7/';
const CARSON: SharedPlace = {
  name: 'Carson Falls',
  city: 'Fairfax',
  lat: 37.98,
  lng: -122.62,
  detail: 'Tiered falls up a fire road',
  source: 'on_screen',
  saved: null,
};
const CATARACT: SharedPlace = {
  ...CARSON,
  name: 'Cataract Falls',
  detail: null,
  source: 'caption',
  saved: { id: 'cataract-falls', name: 'Cataract Falls', city: 'Fairfax', distanceMeters: 10, confidence: 'high' },
};

function answer(over: Partial<SharedPlaces> = {}): SharedPlaces {
  return {
    post: {
      url: REEL,
      author: 'bayareatrails',
      caption: 'Two waterfalls in one morning',
      imageUrl: 'https://scontent.cdninstagram.com/v/poster.jpg',
      isVideo: true,
    },
    places: [CARSON, CATARACT],
    read: { caption: true, video: true, geotag: false },
    ...over,
  };
}

// Shares another post while the page is open, as a second share would.
function ShareAnother({ url }: { url: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(`/share?url=${encodeURIComponent(url)}`)}>
      Share another
    </button>
  );
}

const OTHER = 'https://www.instagram.com/p/Dc1X4T0mPon/';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/share"
          element={
            <>
              <SharePage />
              <ShareAnother url={OTHER} />
            </>
          }
        />
        <Route path="/" element={<p>The catalog</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const shareUrl = (url = REEL) => `/share?url=${encodeURIComponent(url)}`;

beforeEach(() => {
  clerk.enabled = false;
  Object.assign(ownerState, { isLoaded: true, email: 'owner@example.com', isOwner: true });
  found.fn.mockReset();
  opened.fn.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SharePage — no link yet', () => {
  it('takes a pasted link and reads it', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt('/share');
    expect(screen.getByRole('heading', { name: 'Add places from Instagram' })).toBeInTheDocument();
    const find = screen.getByRole('button', { name: 'Find places' });
    expect(find).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to a post or reel' }), '   ');
    expect(find).toBeDisabled();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Link to a post or reel' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to a post or reel' }), `look ${REEL} `);
    await userEvent.click(find);
    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
    expect(found.fn).toHaveBeenCalledWith(REEL, '');
  });

  it('pastes from the clipboard when it’s allowed', async () => {
    renderAt('/share');
    // userEvent installs its own clipboard, so swap it after setup.
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.resolve(REEL) },
      configurable: true,
    });
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(screen.getByRole('textbox', { name: 'Link to a post or reel' })).toHaveValue(REEL);
  });

  it('leaves the field to them when the clipboard is off limits', async () => {
    renderAt('/share');
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
      configurable: true,
    });
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(screen.getByRole('textbox', { name: 'Link to a post or reel' })).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says a shared link isn’t to a post, and reads nothing', async () => {
    renderAt('/share?url=https%3A%2F%2Fevil.example%2Fp%2FDdl9QKSv0D7%2F');
    expect(screen.getByRole('heading', { name: 'Add places from Instagram' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("That isn't a link to an Instagram post or reel");
    expect(screen.queryByRole('link', { name: 'Open on Instagram' })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 10));
    expect(found.fn).not.toHaveBeenCalled();
  });

  it('asks again for a pasted link that isn’t to a post', async () => {
    renderAt('/share?text=%20');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to a post or reel' }), 'https://example.com/reel/Ddl9QKSv0D7/');
    await userEvent.click(screen.getByRole('button', { name: 'Find places' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a link to an Instagram post or reel');
    expect(found.fn).not.toHaveBeenCalled();
  });

  it('asks again for something that isn’t a link', async () => {
    renderAt('/share');
    await userEvent.type(screen.getByRole('textbox', { name: 'Link to a post or reel' }), 'carson falls');
    await userEvent.click(screen.getByRole('button', { name: 'Find places' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a link to an Instagram post or reel');
    expect(found.fn).not.toHaveBeenCalled();
  });
});

describe('SharePage — signed out', () => {
  it('asks a visitor to sign in, and reads nothing for them', async () => {
    Object.assign(ownerState, { email: null, isOwner: false });
    renderAt(shareUrl());
    expect(screen.getByRole('heading', { name: 'Sign in to add places' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on Instagram' })).toHaveAttribute('href', REEL);
    // No Clerk, no sign-in button: the header's sign-in is the stub's.
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 10));
    expect(found.fn).not.toHaveBeenCalled();
  });

  it('offers Clerk’s sign-in where the app has it', () => {
    clerk.enabled = true;
    Object.assign(ownerState, { email: null, isOwner: false });
    renderAt(shareUrl());
    expect(within(screen.getByTestId('clerk-sign-in')).getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('reads the post as soon as sign-in has loaded', async () => {
    Object.assign(ownerState, { isLoaded: false, email: null });
    found.fn.mockResolvedValue(answer());
    const view = renderAt(shareUrl());
    await new Promise((r) => setTimeout(r, 10));
    expect(found.fn).not.toHaveBeenCalled();
    Object.assign(ownerState, { isLoaded: true, email: 'owner@example.com' });
    view.rerender(
      <MemoryRouter initialEntries={[shareUrl()]}>
        <Routes>
          <Route path="/share" element={<SharePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
    expect(found.fn).toHaveBeenCalledTimes(1);
  });

  it('reads once, even mounted twice as development does', async () => {
    found.fn.mockResolvedValue(answer());
    render(
      <StrictMode>
        <MemoryRouter initialEntries={[shareUrl()]}>
          <Routes>
            <Route path="/share" element={<SharePage />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
    expect(found.fn).toHaveBeenCalledTimes(1);
  });

  it('waits for sign-in to load before reading', async () => {
    Object.assign(ownerState, { isLoaded: false, email: null });
    renderAt(shareUrl());
    await new Promise((r) => setTimeout(r, 10));
    expect(found.fn).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Sign in to add places' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('SharePage — the places in a post', () => {
  it('reads the shared post, then lists its places to add one at a time', async () => {
    let resolve!: (v: SharedPlaces) => void;
    found.fn.mockReturnValue(new Promise<SharedPlaces>((r) => (resolve = r)));
    renderAt(shareUrl());
    expect(await screen.findByRole('status')).toHaveTextContent('Reading the reel for places…');
    // Until it's read, the card has the link and nothing else: no empty caption.
    expect(screen.getByText('Post').parentElement!.querySelectorAll('p')).toHaveLength(1);
    expect(found.fn).toHaveBeenCalledTimes(1);
    expect(found.fn).toHaveBeenCalledWith(REEL, '');
    resolve(answer());

    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Reel · @bayareatrails')).toBeInTheDocument();
    expect(screen.getByText('Two waterfalls in one morning')).toBeInTheDocument();
    expect(screen.getByText('Fairfax · on screen')).toBeInTheDocument();
    expect(screen.getByText('Tiered falls up a fire road')).toBeInTheDocument();
    expect(screen.getByText('Fairfax · in the caption')).toBeInTheDocument();
    // A place with nothing more to say has no empty line for it.
    expect(screen.getByText('Cataract Falls').closest('li')!.querySelectorAll('p')).toHaveLength(2);
    expect(screen.queryByText(/couldn't be watched/)).not.toBeInTheDocument();
    const poster = document.querySelector('img');
    expect(poster).toHaveAttribute('referrerpolicy', 'no-referrer');
    // A poster that won't load (its link expired) leaves no empty box.
    fireEvent.error(poster!);
    expect(document.querySelector('img')).toBeNull();

    // Already in the catalog: open it instead.
    await userEvent.click(screen.getByRole('button', { name: 'Open Cataract Falls, already saved' }));
    expect(opened.fn).toHaveBeenCalledWith('cataract-falls');

    // An owner adds the other, drafted from the place and the post.
    await userEvent.click(screen.getByRole('button', { name: 'Add Carson Falls' }));
    const dialog = screen.getByRole('dialog', { name: 'Add an activity' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('seed-title')).toHaveTextContent('Carson Falls, Fairfax');
    // The activity keeps the reel it came from.
    expect(screen.getByTestId('source')).toHaveTextContent(REEL);
    expect(screen.getByTestId('seed-notes')).toHaveTextContent(`From an Instagram reel by @bayareatrails: ${REEL}`);
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Added')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Carson Falls' })).not.toBeInTheDocument();
  });

  it('sends anyone else signed in home, reading nothing', async () => {
    Object.assign(ownerState, { email: 'friend@example.com', isOwner: false });
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    expect(await screen.findByText('The catalog')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 10));
    expect(found.fn).not.toHaveBeenCalled();
  });

  it('opens a duplicate the dialog finds, closing the dialog', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    await userEvent.click(await screen.findByRole('button', { name: 'Add Carson Falls' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open the duplicate' }));
    expect(opened.fn).toHaveBeenCalledWith('dup-id');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds a place by hand, drafted from just the post, which marks no row', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    await userEvent.click(await screen.findByRole('button', { name: 'Add one by hand' }));
    expect(screen.getByTestId('seed-title')).toBeEmptyDOMElement();
    expect(screen.getByTestId('seed-notes')).toHaveTextContent(`From an Instagram reel by @bayareatrails: ${REEL}`);
    expect(screen.getByRole('dialog', { name: 'Add an activity' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close it' }));
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
  });

  it('says when a reel’s video couldn’t be watched', async () => {
    found.fn.mockResolvedValue(answer({ read: { caption: true, video: false, geotag: false } }));
    renderAt(shareUrl());
    expect(await screen.findByText(/The video couldn't be watched this time/)).toBeInTheDocument();
  });

  it('says nothing of video for a photo post, and reads it as a post', async () => {
    let resolve!: (v: SharedPlaces) => void;
    found.fn.mockReturnValueOnce(Promise.resolve(answer({
      post: { url: REEL, author: null, caption: null, imageUrl: null, isVideo: false },
      places: [],
      read: { caption: false, video: false, geotag: false },
    })));
    renderAt(shareUrl());
    expect(await screen.findByRole('heading', { name: 'No places found in this post' })).toBeInTheDocument();
    expect(screen.getByText('Post')).toBeInTheDocument();
    expect(screen.queryByText(/couldn't be watched/)).not.toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Name a place from it')).toBeInTheDocument();

    // Looking again says it's reading a post, now that it knows.
    found.fn.mockReturnValueOnce(new Promise<SharedPlaces>((r) => (resolve = r)));
    await userEvent.type(screen.getByRole('textbox', { name: 'Name a place from it' }), 'the beach');
    await userEvent.click(screen.getByRole('button', { name: 'Look again with this' }));
    expect(screen.getByRole('status')).toHaveTextContent('Reading the post for places…');
    resolve(answer());
    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
  });

  it('looks again with a hint for a place it missed', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    const look = await screen.findByRole('button', { name: 'Look again with this' });
    expect(screen.getByText('Missing a place? Name it')).toBeInTheDocument();
    expect(look).toBeDisabled();
    const field = screen.getByRole('textbox', { name: 'Missing a place? Name it' });
    expect(field).toHaveAttribute('maxlength', '300');
    await userEvent.type(field, '   ');
    expect(look).toBeDisabled();
    await userEvent.type(field, 'the bridge at the end');
    found.fn.mockResolvedValue(answer({ places: [CARSON, CATARACT, { ...CARSON, name: 'Bon Tempe Dam', source: 'hint' }] }));
    await userEvent.click(look);
    expect(await screen.findByRole('heading', { name: '3 places in this post' })).toBeInTheDocument();
    expect(found.fn).toHaveBeenLastCalledWith(REEL, '   the bridge at the end');
    expect(screen.getByText('Fairfax · your hint')).toBeInTheDocument();
  });

  it('finds the link in shared text, as Android sends it', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(`/share?text=${encodeURIComponent(`Check this out ${REEL}`)}`);
    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
    expect(found.fn).toHaveBeenCalledWith(REEL, '');
  });

  it('goes back to the catalog', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    await userEvent.click(screen.getByRole('button', { name: 'Back to the catalog' }));
    expect(await screen.findByText('The catalog')).toBeInTheDocument();
  });
});

describe('SharePage — another share', () => {
  it('starts over for the next post, and never shows the last one’s late answer', async () => {
    let answerFirst!: (v: SharedPlaces) => void;
    found.fn.mockImplementation((url: string) =>
      url === REEL
        ? new Promise<SharedPlaces>((r) => (answerFirst = r))
        : Promise.resolve(
            answer({
              post: { url: OTHER, author: 'sfflowers', caption: 'Spring blooms', imageUrl: null, isVideo: false },
              places: [{ ...CARSON, name: 'Conservatory of Flowers', city: 'San Francisco' }],
            }),
          ),
    );
    renderAt(shareUrl());
    await screen.findByRole('status');
    await userEvent.click(screen.getByRole('button', { name: 'Share another' }));
    expect(await screen.findByRole('heading', { name: '1 place in this post' })).toBeInTheDocument();
    expect(found.fn).toHaveBeenLastCalledWith(OTHER, '');
    // The first post's answer, arriving late, changes nothing.
    answerFirst(answer());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole('heading', { name: '1 place in this post' })).toBeInTheDocument();
    expect(screen.getByText('Post · @sfflowers')).toBeInTheDocument();
    expect(screen.queryByText('Carson Falls')).not.toBeInTheDocument();
  });

  it('drops the hint and what was added with the last post', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    await userEvent.type(await screen.findByRole('textbox', { name: 'Missing a place? Name it' }), 'the dam');
    await userEvent.click(screen.getByRole('button', { name: 'Add Carson Falls' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close it' }));
    expect(screen.getByText('Added')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Share another' }));
    expect(await screen.findByRole('textbox', { name: 'Missing a place? Name it' })).toHaveValue('');
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
  });
});

describe('SharePage — when reading fails', () => {
  it('says what went wrong, and tries again', async () => {
    found.fn.mockRejectedValueOnce(new Error('Gemini couldn’t read the post'));
    renderAt(shareUrl());
    expect(await screen.findByRole('alert')).toHaveTextContent('Gemini couldn’t read the post');
    expect(screen.getByRole('link', { name: 'Open on Instagram' })).toHaveAttribute('href', REEL);
    found.fn.mockResolvedValueOnce(answer());
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: '2 places in this post' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says something even for a failure with no message', async () => {
    found.fn.mockRejectedValueOnce('offline');
    renderAt(shareUrl());
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read the post");
  });

  it('offers adding by hand when reading failed too', async () => {
    found.fn.mockRejectedValueOnce(new Error('Gemini couldn’t read the post'));
    renderAt(shareUrl());
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Add one by hand' }));
    expect(screen.getByRole('dialog', { name: 'Add an activity' })).toBeInTheDocument();
    expect(screen.getByTestId('seed-title')).toBeEmptyDOMElement();
    expect(screen.getByTestId('seed-notes')).toHaveTextContent(`From an Instagram post: ${REEL}`);
  });

  it('reads the post only once a link is found', async () => {
    found.fn.mockResolvedValue(answer());
    renderAt(shareUrl());
    await waitFor(() => expect(found.fn).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(found.fn).toHaveBeenCalledTimes(1);
  });
});
