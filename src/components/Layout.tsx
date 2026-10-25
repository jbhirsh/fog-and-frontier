import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../lib/authShim';
import { useOwner } from '../lib/useOwner';

function navClass({ isActive }: { isActive: boolean }) {
  // Active state carries a non-color cue (underline + weight) as well as color,
  // so it's distinguishable without relying on hue alone (WCAG 1.4.1). The
  // hit area reaches past the text, a finger's height, without making the
  // header any taller.
  const hit = "relative before:absolute before:-inset-x-xs before:-inset-y-sm before:content-['']";
  return isActive
    ? `${hit} text-secondary font-semibold underline decoration-2 underline-offset-[6px] transition-colors`
    : `${hit} text-on-surface-variant font-medium hover:text-secondary transition-colors`;
}

function NavSeparator() {
  return (
    <span aria-hidden="true" className="text-outline-variant/70">
      |
    </span>
  );
}

export function Layout() {
  // Catalog search (per the #4 mockup) drives the `?q=` filter. The box is
  // rendered only on the catalog ("/") — see the conditional below — so it
  // never appears (or writes a stray `?q=`) on Explore / Trips.
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const q = params.get('q') ?? '';
  const showSearch = pathname === '/';
  // The mobile map (#96) is a full-screen backdrop, so the tall wrapping
  // header (search and nav rows) would bury its top. Below `lg` the header
  // collapses to a slim brand · auth bar there; the desktop map isn't full
  // bleed and keeps the full header.
  const isMapView = pathname === '/' && params.get('view') === 'map';
  // Explore is an owner-only surface (#111); its route is guarded in App.tsx.
  const { isOwner } = useOwner();

  function handleChange(next: string) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set('q', next);
        else p.delete('q');
        return p;
      },
      { replace: true },
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-outline-variant/30 bg-surface/80 backdrop-blur-xl">
        {/* Desktop (md+): one 80px row — brand · search · compact nav · auth.
            Mobile: wraps to [brand · auth], then the search, then the nav.
            order-* re-sequences the four for each layout. */}
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center gap-x-md gap-y-sm py-sm px-margin md:h-20 md:py-0">
          <NavLink
            to="/"
            className="order-1 font-display text-headline-md font-bold whitespace-nowrap text-primary"
          >
            Fog and Frontier
          </NavLink>

          {showSearch && (
            <form
              role="search"
              onSubmit={(e) => e.preventDefault()}
              className={`order-3 w-full md:order-2 md:w-[min(42vw,520px)] ${
                isMapView ? 'hidden lg:block' : ''
              }`}
            >
              <label className="flex items-center gap-sm rounded-full border border-outline-variant bg-surface-container-lowest py-xs pr-xs pl-gutter shadow-sm transition-all focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/20">
                <span className="material-symbols-outlined text-outline">search</span>
                <input
                  value={q}
                  onChange={(e) => handleChange(e.target.value)}
                  className="min-w-0 grow border-none bg-transparent text-body-md focus:outline-none"
                  placeholder="Search adventures, places, trails…"
                  type="text"
                  aria-label="Search adventures"
                />
                <button
                  type="submit"
                  aria-label="Search"
                  className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-on-secondary transition-opacity hover:opacity-90"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                    arrow_forward
                  </span>
                </button>
              </label>
            </form>
          )}

          <nav
            className={`order-4 flex w-full items-center justify-center gap-x-sm text-body-sm whitespace-nowrap md:order-3 md:ml-auto md:w-auto md:justify-end ${
              isMapView ? 'hidden lg:flex' : ''
            }`}
          >
            <NavLink to="/" end className={navClass}>
              Curated
            </NavLink>
            {isOwner && (
              <>
                <NavSeparator />
                <NavLink to="/explore" className={navClass}>
                  Explore
                </NavLink>
              </>
            )}
            <NavSeparator />
            <NavLink to="/trips" className={navClass}>
              Trips
            </NavLink>
          </nav>

          <div className="order-2 ml-auto flex shrink-0 items-center md:order-4 md:ml-0">
            {CLERK_ENABLED && (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="rounded-full bg-primary px-md py-sm font-body-md text-on-primary transition-opacity hover:opacity-90"
                    >
                      Sign in
                    </button>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <UserButton
                    afterSignOutUrl="/"
                    appearance={{
                      elements: { userButtonAvatarBox: 'w-11 h-11' },
                    }}
                  />
                </SignedIn>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="grow">
        <Outlet />
      </main>
      {/* The catalog/split view (#4) owns the full page scroll Airbnb-style, so
          the footer is suppressed there; other pages keep it. */}
      {pathname !== '/' && (
        <footer className="mt-md w-full bg-primary pt-md pb-[calc(var(--spacing-md)+env(safe-area-inset-bottom))] md:mt-xl md:py-xl">
          <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-md px-margin md:flex-row">
            <div className="font-display text-headline-md font-bold text-on-primary">
              Fog and Frontier
            </div>
            <div className="text-center font-body-md text-body-md text-on-primary/70 md:text-right">
              Inspired by the Pacific Coast.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
