import { useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { catalogHref, currentTab } from '../lib/tabs';
import { useOwner } from '../lib/useOwner';
import { useTyping } from '../lib/useTyping';

const TAB =
  'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors';
const ON = 'font-semibold text-primary';
const OFF = 'font-medium text-on-surface-variant hover:text-primary';

// A set box, so the tabs stay equal while the icon font loads, when each
// icon is still its name in plain text.
function Icon({ name }: { name: string }) {
  return (
    <span
      className="material-symbols-outlined size-6 overflow-hidden"
      aria-hidden="true"
      style={{ fontSize: 24 }}
    >
      {name}
    </span>
  );
}

/**
 * The phone's tabs (#289): Places, Map, Explore (owners, #111), Trips, and
 * Add for owners or Suggest for anyone else signed in (#73); signed-out
 * visitors get neither. Fixed to the bottom, above the home indicator, and
 * gone from md up, where the header carries the links. Map replaces the
 * list's "Show map" and the map's "Hide map"; both tabs keep the catalog's
 * search and filters. It steps aside while the keyboard is up, which an
 * iPhone would otherwise float it above, mid-screen.
 */
export function PhoneTabBar() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isOwner, email } = useOwner();
  const typing = useTyping();
  // What keeps clear of the bar (the page's foot, the map's list sheet)
  // comes down with it, rather than leaving a band where it was.
  useEffect(() => {
    if (!typing) return;
    document.documentElement.dataset.typing = '';
    return () => {
      delete document.documentElement.dataset.typing;
    };
  }, [typing]);
  // The catalog's params only mean anything on the catalog.
  const catalogParams = pathname === '/' ? params : new URLSearchParams();
  const tab = currentTab(pathname, params.get('view'));
  const link = (name: string) => ({
    className: `${TAB} ${tab === name ? ON : OFF}`,
    'aria-current': tab === name ? ('page' as const) : undefined,
  });

  return (
    <nav
      aria-label="Main"
      className={`fixed inset-x-0 bottom-0 z-45 border-t border-outline-variant/40 bg-surface-container-lowest/95 px-base pb-[env(safe-area-inset-bottom)] backdrop-blur-xl ${typing ? 'hidden' : 'flex md:hidden'}`}
    >
      <Link to={catalogHref(catalogParams, null)} {...link('places')}>
        <Icon name="format_list_bulleted" />
        Places
      </Link>
      <Link to={catalogHref(catalogParams, 'map')} {...link('map')}>
        <Icon name="map" />
        Map
      </Link>
      {isOwner && (
        <Link to="/explore" {...link('explore')}>
          <Icon name="explore" />
          Explore
        </Link>
      )}
      <Link to="/trips" {...link('trips')}>
        <Icon name="luggage" />
        Trips
      </Link>
      {/* The catalog opens its add or suggest dialog on this (#73). */}
      {(isOwner || email) && (
        <button
          type="button"
          onClick={() => void navigate(catalogHref(catalogParams, null), { state: { add: true } })}
          className={`${TAB} ${OFF}`}
        >
          <Icon name={isOwner ? 'add_circle' : 'lightbulb'} />
          {isOwner ? 'Add' : 'Suggest'}
        </button>
      )}
    </nav>
  );
}
