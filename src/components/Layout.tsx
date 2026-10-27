import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../lib/authShim';
import { useOwner } from '../lib/useOwner';
import { PhoneTabBar } from './PhoneTabBar';

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
  // The mobile map (#96) is a full-screen backdrop, so on a tablet the tall
  // wrapping header (search and nav rows) would bury its top: from md to lg
  // it collapses to a slim brand · auth bar there. A phone's header is one
  // line anyway (#289), and the desktop map isn't full bleed.
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
    // Clear of the phone's tab bar (#289), which sits over the page's foot.
    <div className="flex min-h-dvh flex-col pb-(--tab-bar)">
      {/* A trip's page on a phone (#294) has its own header, Trips and all:
          while one is up (TripPhone marks the page) the brand's bar would
          only repeat it. Its loading and sign-in screens keep the bar. */}
      <header className="sticky top-0 z-50 border-b border-outline-variant/30 bg-surface/80 backdrop-blur-xl in-data-own-header:max-md:hidden">
        {/* Desktop (md+): one 80px row — brand · search · compact nav · auth.
            A phone (#289): one line, the search and auth on the catalog,
            the brand and auth elsewhere; its links are the tab bar's.
            order-* re-sequences the four for each layout. */}
        <div className="mx-auto flex w-full max-w-screen-2xl flex-wrap items-center gap-x-md gap-y-sm py-sm px-margin md:h-20 md:py-0">
          <NavLink
            to="/"
            className={`order-1 font-display text-headline-md font-bold whitespace-nowrap text-primary ${
              showSearch ? 'hidden md:block' : ''
            }`}
          >
            Fog and Frontier
          </NavLink>

          {showSearch && (
            <form
              role="search"
              onSubmit={(e) => e.preventDefault()}
              className={`order-1 min-w-0 flex-1 md:order-2 md:w-[min(42vw,520px)] md:flex-none ${
                isMapView ? 'md:max-lg:hidden' : ''
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
            className={`order-4 hidden w-full items-center justify-center gap-x-sm text-body-sm whitespace-nowrap md:order-3 md:ml-auto md:w-auto md:justify-end ${
              isMapView ? 'lg:flex' : 'md:flex'
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
      <PhoneTabBar />
      {/* The catalog/split view (#4) owns the full page scroll Airbnb-style, so
          the footer is suppressed there; other pages keep it, from md up: on a
          phone the tab bar is the page's foot. */}
      {pathname !== '/' && (
        <footer className="mt-xl hidden w-full bg-primary py-xl md:block">
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
