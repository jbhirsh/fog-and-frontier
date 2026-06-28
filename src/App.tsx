import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';
import { Layout } from './components/Layout';
import { CuratedAdventures } from './pages/CuratedAdventures';
import { Explore } from './pages/Explore';
import { Adventures } from './pages/Adventures';
import { Trips } from './pages/Trips';
import { NewTrip } from './pages/NewTrip';
import { TripDetail } from './pages/TripDetail';
import { Sentry } from './lib/sentry';

// Wrap once at module scope so Sentry can attach route-change spans for
// pageload + navigation transactions. A no-op when initSentry didn't run
// (no DSN, e.g. local dev).
const SentryRoutes = Sentry.withSentryReactRouterV7Routing(Routes);

export default function App() {
  return (
    <BrowserRouter>
      <SentryRoutes>
        {/* Clerk OAuth (e.g., "Sign in with Google") sends the browser to
            <site>/sso-callback after the identity provider hands control back
            to Clerk. This route lets Clerk finish the handshake and then
            navigate the user back to where they started. Must be outside
            Layout so the chrome doesn't flash. */}
        <Route
          path="/sso-callback"
          element={<AuthenticateWithRedirectCallback />}
        />
        <Route element={<Layout />}>
          <Route path="/" element={<CuratedAdventures />} />
          <Route path="/explore" element={<Explore />} />
          <Route path="/adventures" element={<Adventures />} />
          {/* The standalone Map page is superseded by the combined split view
              (#4 / #93). Keep the old URL working by aliasing it to Map mode. */}
          <Route path="/map" element={<Navigate to="/?view=map" replace />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/trips/new" element={<NewTrip />} />
          <Route path="/trips/:id" element={<TripDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </SentryRoutes>
    </BrowserRouter>
  );
}
