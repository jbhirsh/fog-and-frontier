import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApolloProvider } from '@apollo/client/react';
import './index.css';
import App from './App.tsx';
import { AuthProvider } from './lib/authSession';
import { SIGN_IN_ENABLED } from './lib/authShim';
import { apolloClient } from './lib/apolloClient';
import { Sentry, initSentry } from './lib/sentry';
import { dropLegacyPhotos } from './lib/userPhotos';

initSentry();
// Photos moved to private Blob storage (#19); free what the old per-device
// copies took.
dropLegacyPhotos();

// ApolloProvider wraps App either way, so the data layer works whether or
// not this build can sign anyone in. Requests carry the session cookie on
// their own, so no read waits for the session to load.
const app = (
  <ApolloProvider client={apolloClient}>
    <App />
  </ApolloProvider>
);

const tree = SIGN_IN_ENABLED ? <AuthProvider>{app}</AuthProvider> : app;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1>Something went wrong.</h1>
          <p>Reload the page to try again.</p>
        </div>
      }
    >
      {tree}
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
