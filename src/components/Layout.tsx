import { useState } from 'react';
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../lib/authShim';
import { useOwner } from '../lib/useOwner';
import { useMediaQuery } from '../lib/useMediaQuery';
import { HeaderSlotContext } from '../lib/headerSlot';
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
  // The box has room for the whole prompt (about 265px of it) only from lg
  // up; narrower, on a phone (#289) or a tablet, it's one word.
  const wide = useMediaQuery('(min-width: 64rem)');
  // The page's own controls (the catalog's Filters, view toggle and
  // actions), drawn into the row between the search and the nav.
  const [slot, setSlot] = useState<HTMLElement | null>(null);

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
        {/* One row at every width, everything in it 44px tall: brand ·
            search · the page's controls · nav · auth (#289). On the catalog
            the search stands in for the brand below xl, where the row has
            no room for both, and a phone's links are its tab bar's. order-*
            re-sequences them for each layout. */}
        <div className="mx-auto flex w-full max-w-screen-2xl items-center gap-x-base py-sm px-margin md:h-20 md:gap-x-sm md:py-0 lg:gap-x-md">
          <NavLink
            to="/"
            className={`order-1 font-display text-headline-md font-bold whitespace-nowrap text-primary ${
              // The catalog's row is full until xl; its map from md to lg
              // has no search or controls, so the brand comes back there.
              showSearch ? (isMapView ? 'hidden md:max-lg:block xl:block' : 'hidden xl:block') : ''
            }`}
          >
            Fog and Frontier
          </NavLink>

          {showSearch && (
            <form
              role="search"
              // The list filters as it's typed; Search or Enter puts the
              // keyboard away, so a phone can see what it found.
              onSubmit={(e) => {
                e.preventDefault();
                e.currentTarget.querySelector('input')?.blur();
              }}
              className={`order-1 min-w-0 flex-1 md:order-2 md:max-w-140 ${
                isMapView ? 'md:max-lg:hidden' : ''
              }`}
            >
              <label className="flex h-11 items-center gap-sm rounded-full border border-outline-variant bg-surface-container-lowest pr-xs pl-gutter shadow-sm transition-all focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/20">
                <span className="material-symbols-outlined text-outline">search</span>
                <input
                  value={q}
                  onChange={(e) => handleChange(e.target.value)}
                  // A prompt longer than the box ends in an ellipsis.
                  className="min-w-0 grow border-none bg-transparent text-body-md text-ellipsis focus:outline-none"
                  placeholder={wide ? 'Search adventures, places, trails…' : 'Search'}
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

          <div
            ref={setSlot}
            className="order-2 flex shrink-0 items-center gap-x-base empty:hidden md:order-3 md:gap-x-sm"
          />

          <nav
            className={`order-4 hidden items-center gap-x-sm text-body-sm whitespace-nowrap md:ml-auto ${
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

          <div
            className={`order-3 ml-auto flex shrink-0 items-center md:order-5 ${
              // Pushed right by the nav where it shows; on the map from md
              // to lg, which has none, by itself.
              isMapView ? 'md:max-lg:ml-auto lg:ml-0' : 'md:ml-0'
            }`}
          >
            {CLERK_ENABLED && (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="inline-flex h-11 items-center rounded-full bg-primary px-md font-body-md text-on-primary transition-opacity hover:opacity-90"
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
        <HeaderSlotContext.Provider value={slot}>
          <Outlet />
        </HeaderSlotContext.Provider>
      </main>
      <PhoneTabBar />
    </div>
  );
}
