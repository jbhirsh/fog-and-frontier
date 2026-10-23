import { useEffect, useEffectEvent, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { SignInButton } from '@clerk/clerk-react';
import { AddActivity } from '../components/AddActivity';
import { CdnImage } from '../components/CdnImage';
import { useOpenActivity } from '../lib/activityRoute';
import { CLERK_ENABLED } from '../lib/authShim';
import {
  SOURCE_LABEL,
  bareSharedPost,
  draftSeed,
  findSharedPlaces,
  instagramLink,
  postSeed,
  sharedLink,
  type SharedPlace,
  type SharedPlaces,
} from '../lib/sharedPlaces';
import { useOwner } from '../lib/useOwner';

// Share an Instagram post or reel to the app (#6): /share?url=… from the
// iPhone Shortcut or Android's share sheet, or a link pasted here. The post's
// places are listed, each added one at a time through the usual Add dialog,
// drafted from the place and the post. For owners only, like Explore (#111):
// reading a post is a paid Gemini call. Anyone else signed in is sent home;
// someone signed out is asked to sign in, since it may be an owner whose
// browser (Safari, from the Shortcut) isn't signed in yet.

// A place from the list, or one to add by hand.
type Picked = SharedPlace | 'by-hand';

const placeKey = (place: SharedPlace) => `${place.name}|${place.city}`;

const PRIMARY =
  'inline-flex items-center justify-center gap-xs min-h-11 bg-primary text-on-primary px-md rounded-full font-body-md hover:opacity-90 transition-opacity disabled:opacity-50';
const SECONDARY =
  'inline-flex items-center justify-center gap-xs min-h-11 px-md rounded-full font-body-md text-primary-container border border-outline-variant hover:bg-surface-container transition-colors disabled:opacity-50';
const INPUT =
  'w-full min-h-11 px-sm rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-container';

export function SharePage() {
  const [params, setParams] = useSearchParams();
  const link = sharedLink(params);
  if (!link) {
    // Something was shared, or put in the address, that isn't a post.
    const offered = ['url', 'text', 'title'].some((key) => params.get(key)?.trim());
    return <PasteLink notInstagram={offered} onLink={(url) => setParams({ url })} />;
  }
  // Keyed by the post, so nothing found for one is shown for the next.
  return <SharedPost key={link} link={link} />;
}

function PasteLink({ notInstagram, onLink }: { notInstagram: boolean; onLink: (url: string) => void }) {
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(
    notInstagram ? "That isn't a link to an Instagram post or reel" : null,
  );

  async function paste() {
    try {
      setPasted(await navigator.clipboard.readText());
    } catch {
      // Not allowed: they can paste into the field themselves.
    }
  }
  function findPasted() {
    const url = instagramLink(pasted);
    if (url) onLink(url);
    else setError('Paste a link to an Instagram post or reel');
  }

  return (
    <Page>
      <h1 className="font-display text-headline-lg text-primary">Add places from Instagram</h1>
      <p className="font-body-md text-on-surface-variant">
        Share a reel or post to Fog and Frontier, or paste its link here.
      </p>
      <label className="block space-y-xs">
        <span className="font-label-caps text-label-caps text-on-surface-variant">Link to a post or reel</span>
        <input
          type="url"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="https://www.instagram.com/reel/…"
          className={INPUT}
        />
      </label>
      <div className="flex flex-wrap gap-sm">
        <button type="button" onClick={() => void paste()} className={SECONDARY}>
          <span className="material-symbols-outlined text-icon-md" aria-hidden="true">
            content_paste
          </span>
          Paste
        </button>
        <button type="button" onClick={findPasted} disabled={!pasted} className={PRIMARY}>
          Find places
        </button>
      </div>
      {error && <p role="alert" className="font-body-md text-error">{error}</p>}
    </Page>
  );
}

function SharedPost({ link }: { link: string }) {
  const navigate = useNavigate();
  const openActivity = useOpenActivity();
  const { isLoaded, email, isOwner } = useOwner();

  const [found, setFound] = useState<SharedPlaces | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState('');
  const [posterFailed, setPosterFailed] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  // The places added from this page, by placeKey.
  const [added, setAdded] = useState<Record<string, true>>({});

  async function read(withHint = '') {
    setLoading(true);
    setError(null);
    try {
      setFound(await findSharedPlaces(link, withHint));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the post");
    } finally {
      setLoading(false);
    }
  }

  // Read the shared post once an owner is signed in to read it for.
  const canRead = isLoaded && isOwner;
  const readFirst = useEffectEvent(() => void read());
  useEffect(() => {
    if (!canRead) return;
    const start = setTimeout(readFirst, 0);
    return () => clearTimeout(start);
  }, [canRead]);

  if (isLoaded && !email) {
    return (
      <Page>
        <h1 className="font-display text-headline-lg text-primary">Sign in to add places</h1>
        <p className="font-body-md text-on-surface-variant">
          Sign in, and the places in this post are listed here for you to add.
        </p>
        {CLERK_ENABLED && (
          <SignInButton mode="modal">
            <button type="button" className={PRIMARY}>
              Sign in
            </button>
          </SignInButton>
        )}
        <PostLink url={link} />
      </Page>
    );
  }
  if (isLoaded && !isOwner) return <Navigate to="/" replace />;

  // Until it's read, the post is just its link.
  const post = found?.post ?? bareSharedPost(link);
  const byHand = (
    <button type="button" onClick={() => setPicked('by-hand')} className={SECONDARY}>
      Add one by hand
    </button>
  );
  return (
    <Page>
      <div className="flex items-start gap-md p-sm rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
        {post.imageUrl && !posterFailed && (
          <div className="w-16 h-20 shrink-0 rounded-lg overflow-hidden bg-surface-variant">
            <CdnImage
              src={post.imageUrl}
              sizes="64px"
              alt=""
              referrerPolicy="no-referrer"
              onFailed={() => setPosterFailed(true)}
              className="w-full h-full object-cover"
            />
          </div>
        )}
        <div className="min-w-0 space-y-xs">
          <p className="font-label-caps text-label-caps text-on-surface-variant">
            {post.isVideo ? 'Reel' : 'Post'}
            {post.author ? ` · @${post.author}` : ''}
          </p>
          {post.caption && <p className="font-body-md text-on-surface line-clamp-3">{post.caption}</p>}
          <PostLink url={post.url} />
        </div>
      </div>

      {loading && (
        <p role="status" className="font-body-lg text-on-surface-variant">
          Reading the {post.isVideo === false ? 'post' : 'reel'} for places…
        </p>
      )}

      {!loading && error && (
        <div role="alert" className="space-y-sm">
          <p className="font-body-md text-error">{error}</p>
          <div className="flex flex-wrap gap-sm">
            <button type="button" onClick={() => void read(hint)} className={SECONDARY}>
              Try again
            </button>
            {byHand}
          </div>
        </div>
      )}

      {!loading && found && (
        <>
          <h1 className="font-display text-headline-md text-primary">
            {found.places.length === 0
              ? 'No places found in this post'
              : found.places.length === 1
                ? '1 place in this post'
                : `${found.places.length} places in this post`}
          </h1>
          {post.isVideo && !found.read.video && (
            <p className="font-body-md text-on-surface-variant">
              The video couldn't be watched this time, so a place shown only on screen may be missing.
              Name it below.
            </p>
          )}
          <ul className="space-y-sm">
            {found.places.map((place) => {
              const key = placeKey(place);
              return (
                <li
                  key={key}
                  className="flex items-center gap-sm p-sm rounded-xl border border-outline-variant/40 bg-surface-container-lowest"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-body-md font-semibold text-on-surface">{place.name}</p>
                    <p className="font-body-sm text-on-surface-variant">
                      {place.city} · {SOURCE_LABEL[place.source]}
                    </p>
                    {place.detail && <p className="font-body-sm text-on-surface-variant">{place.detail}</p>}
                  </div>
                  {added[key] ? (
                    <span className="inline-flex items-center gap-xs font-body-md text-primary-container">
                      <span className="material-symbols-outlined text-icon-md" aria-hidden="true">
                        check
                      </span>
                      Added
                    </span>
                  ) : place.saved ? (
                    <button type="button" onClick={() => openActivity(place.saved!.id)} className={SECONDARY}>
                      Open{' '}
                      <span className="sr-only">{place.saved.name}, already saved</span>
                    </button>
                  ) : (
                    <button type="button" onClick={() => setPicked(place)} className={PRIMARY}>
                      Add{' '}
                      <span className="sr-only">{place.name}</span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="space-y-sm pt-sm">
            <label className="block space-y-xs">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                {found.places.length === 0 ? 'Name a place from it' : 'Missing a place? Name it'}
              </span>
              <input
                type="text"
                value={hint}
                maxLength={300}
                onChange={(e) => setHint(e.target.value)}
                placeholder="e.g. the waterfall at 0:18"
                className={INPUT}
              />
            </label>
            <div className="flex flex-wrap gap-sm">
              <button
                type="button"
                onClick={() => void read(hint)}
                disabled={!hint.trim()}
                className={SECONDARY}
              >
                Look again with this
              </button>
              {byHand}
            </div>
          </div>
        </>
      )}

      {picked && (
        <AddActivity
          key={picked === 'by-hand' ? picked : placeKey(picked)}
          seed={picked === 'by-hand' ? postSeed(post) : draftSeed(picked, post)}
          onClose={() => setPicked(null)}
          onOpenActivity={(id) => {
            setPicked(null);
            openActivity(id);
          }}
          onSaved={() => {
            if (picked !== 'by-hand') setAdded((a) => ({ ...a, [placeKey(picked)]: true }));
          }}
        />
      )}

      <button type="button" onClick={() => void navigate('/')} className="font-body-md text-primary-container underline">
        Back to the catalog
      </button>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <section className="px-margin py-lg max-w-2xl mx-auto space-y-md">{children}</section>;
}

function PostLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-body-sm text-primary-container underline break-all">
      Open on Instagram
    </a>
  );
}
