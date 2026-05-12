import { NavLink, Outlet } from 'react-router-dom';
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/clerk-react';
import { CLERK_ENABLED } from '../lib/authShim';

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'text-secondary font-bold border-b-2 border-secondary pb-1 transition-colors duration-200'
    : 'text-on-surface-variant font-medium hover:text-secondary transition-colors duration-200';
}

export function Layout() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="bg-surface/80 backdrop-blur-xl sticky top-0 z-50 border-b border-outline-variant/30">
        {/* Mobile (default): two-row wrap — [logo, auth] on top, nav full-width
            below. Desktop (md+): single 80px row with logo, nav, auth spread by
            justify-between. order-* swaps nav and auth between breakpoints so
            justify-between works in both layouts. */}
        <div className="flex flex-wrap items-center justify-between gap-x-gutter gap-y-sm px-margin py-sm md:py-0 md:h-20 w-full max-w-screen-2xl mx-auto">
          <NavLink
            to="/"
            className="order-1 font-display text-headline-md font-bold text-primary"
          >
            Fog and Frontier
          </NavLink>
          <div className="order-2 md:order-3 flex items-center shrink-0">
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
                  <UserButton afterSignOutUrl="/" />
                </SignedIn>
              </>
            )}
          </div>
          <nav className="order-3 md:order-2 w-full md:w-auto flex flex-wrap gap-x-md gap-y-xs md:gap-gutter justify-center md:justify-start">
            <NavLink to="/" end className={navClass}>
              Curated
            </NavLink>
            <NavLink to="/explore" className={navClass}>
              Explore
            </NavLink>
            <NavLink to="/map" className={navClass}>
              Map
            </NavLink>
            <NavLink to="/adventures" className={navClass}>
              Adventures
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-grow">
        <Outlet />
      </main>
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
    </div>
  );
}
