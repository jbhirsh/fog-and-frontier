import { NavLink, Outlet } from 'react-router-dom';

function navClass({ isActive }: { isActive: boolean }) {
  return isActive
    ? 'text-secondary font-bold border-b-2 border-secondary pb-1 transition-colors duration-200'
    : 'text-on-surface-variant font-medium hover:text-secondary transition-colors duration-200';
}

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-surface/80 backdrop-blur-xl sticky top-0 z-50 border-b border-outline-variant/30">
        <div className="flex justify-between items-center px-margin h-20 w-full max-w-screen-2xl mx-auto">
          <NavLink
            to="/"
            className="font-display text-headline-md font-bold text-primary"
          >
            Fog and Frontier
          </NavLink>
          <nav className="flex gap-gutter">
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
