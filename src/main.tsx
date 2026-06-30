import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { ApolloProvider } from '@apollo/client/react'
import './index.css'
import App from './App.tsx'
import { ClerkAuthProvider } from './lib/authShimClerk'
import { apolloClient } from './lib/apolloClient'
import { Sentry, initSentry } from './lib/sentry'

initSentry()

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined

// ApolloProvider wraps App in both paths so the data layer works whether or
// not Clerk is configured. It sits *inside* the Clerk providers so the auth
// bridge (ClerkAuthProvider) can register the live token getter before any
// query fires; the no-Clerk path falls back to anonymous (no-token) requests.
const app = (
  <ApolloProvider client={apolloClient}>
    <App />
  </ApolloProvider>
)

const tree = publishableKey ? (
  <ClerkProvider publishableKey={publishableKey}>
    <ClerkAuthProvider>{app}</ClerkAuthProvider>
  </ClerkProvider>
) : (
  app
)

if (!publishableKey) {
  console.warn(
    '[auth] VITE_CLERK_PUBLISHABLE_KEY is not set — running in public-only mode. Owner-gated actions are disabled until Clerk is configured.',
  )
}

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
)
