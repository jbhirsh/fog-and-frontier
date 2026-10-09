import type { ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ACTIVITY_PATH, backgroundFor } from '../lib/activityRoute';
import { ActivityPage } from '../pages/ActivityPage';

interface Props {
  /** The app's page routes. */
  children: ReactNode;
  /** The <Routes> to render them with (the app passes Sentry's wrapper). */
  routes?: typeof Routes;
}

/**
 * An activity permalink (#86) draws its detail over another page: the one it
 * was opened from, or the catalog for a link opened fresh. The page routes
 * render that background page, so its filters and scroll survive, and the
 * detail renders on top.
 */
export function ActivityPermalinkRoutes({
  children,
  routes: PageRoutes = Routes,
}: Props) {
  const location = useLocation();
  const background = backgroundFor(location);
  return (
    <>
      <PageRoutes location={background ?? location}>{children}</PageRoutes>
      {background && (
        <Routes>
          <Route path={ACTIVITY_PATH} element={<ActivityPage />} />
        </Routes>
      )}
    </>
  );
}
