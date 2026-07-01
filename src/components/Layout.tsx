import {
  NavLink,
  Outlet,
  useLocation,
  useSearchParams,
} from 'react-router-dom';
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../lib/authShim';

function navClass({ isActive }: { isActive: boolean }) {
  // Active state carries a non-color cue (underline + weight) as well as color,
  // so it's distinguishable without relying on hue alone (WCAG 1.4.1).
  return isActive
    ? 'text-secondary font-semibold underline decoration-2 underline-offset-[6px] transition-colors'
    : 'text-on-surface-variant font-medium hover:text-secondary transition-colors';
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
  // never appears (or writes a stray `?q=`) on Explore / Trips / Adventures.
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const q = params.get('q') ?? '';
  const showSearch = pathname === '/';
  // On the mobile map view (#96) the map is a full-screen backdrop, so the tall
  // wrapping header (search + nav rows) would bury its top strip and controls.
  // Collapse to a slim brand·auth bar below `lg`; the desktop map keeps the full
  // header (it isn't full-bleed).
  const isMobileMapView = pathname === '/' && params.get('view') === 'map';

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
    <div className="min-h-dvh flex flex-col">
      <header className="bg-surface/80 backdrop-blur-xl sticky top-0 z-50 border-b border-outline-variant/30">
        {/* Desktop (md+): one 80px row — brand · search · compact nav · auth.
            Mobile: wraps to [brand · auth], then the search, then the nav.
            order-* re-sequences the four for each layout. */}
        <div className="flex flex-wrap items-center gap-x-md gap-y-sm px-margin py-sm md:py-0 md:h-20 w-full max-w-screen-2xl mx-auto">
          <NavLink
            to="/"
            className="order-1 font-display text-headline-md font-bold text-primary whitespace-nowrap"
          >
            Fog and Frontier
          </NavLink>

          {showSearch && (
            <form
              role="search"
              onSubmit={(e) => e.preventDefault()}
              className={`order-3 md:order-2 w-full md:w-[min(42vw,520px)] ${
                isMobileMapView ? 'hidden lg:block' : ''
              }`}
            >
              <label className="flex items-center gap-sm rounded-full border border-outline-variant bg-surface-container-lowest pl-gutter pr-xs py-xs shadow-sm transition-all focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/20">
                <span className="material-symbols-outlined text-outline">
                  search
                </span>
                <input
                  value={q}
                  onChange={(e) => handleChange(e.target.value)}
                  className="grow min-w-0 bg-transparent border-none focus:outline-none text-body-md"
                  placeholder="Search adventures, places, trails…"
                  type="text"
                  aria-label="Search adventures"
                />
                <button
                  type="submit"
                  aria-label="Search"
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-on-secondary transition-opacity hover:opacity-90"
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: 20 }}
                  >
                    arrow_forward
                  </span>
                </button>
              </label>
            </form>
          )}

          <nav
            className={`order-4 md:order-3 w-full md:w-auto md:ml-auto flex items-center justify-center md:justify-end gap-x-sm text-body-sm whitespace-nowrap ${
              isMobileMapView ? 'hidden lg:flex' : ''
            }`}
          >
            <NavLink to="/" end className={navClass}>
              Curated
            </NavLink>
            <NavSeparator />
            <NavLink to="/explore" className={navClass}>
              Explore
            </NavLink>
            <NavSeparator />
            <NavLink to="/trips" className={navClass}>
              Trips
            </NavLink>
            <NavSeparator />
            <NavLink to="/adventures" className={navClass}>
              Adventures
            </NavLink>
          </nav>

          <div className="order-2 md:order-4 ml-auto md:ml-0 flex items-center shrink-0">
            {CLERK_ENABLED && (
              <>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="bg-primary text-on-primary px-md py-sm rounded-full font-body-md hover:opacity-90 transition-opacity"
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
      <main className="flex-grow">
        <Outlet />
      </main>
      {/* The catalog/split view (#4) owns the full page scroll Airbnb-style, so
          the footer is suppressed there; other pages keep it. */}
      {pathname !== '/' && (
        <footer className="bg-primary w-full py-xl mt-xl">
          <div className="flex flex-col md:flex-row justify-between items-center px-margin gap-md max-w-screen-2xl mx-auto">
            <div className="font-display text-headline-md font-bold text-on-primary">
              Fog and Frontier
            </div>
            <div className="font-body-md text-body-md text-on-primary/70 text-center md:text-right">
              Inspired by the Pacific Coast.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
