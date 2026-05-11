import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'
import { ClerkAuthProvider } from './lib/authShimClerk'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined

const tree = publishableKey ? (
  <ClerkProvider publishableKey={publishableKey}>
    <ClerkAuthProvider>
      <App />
    </ClerkAuthProvider>
  </ClerkProvider>
) : (
  <App />
)

if (!publishableKey) {
  console.warn(
    '[auth] VITE_CLERK_PUBLISHABLE_KEY is not set — running in public-only mode. Owner-gated actions are disabled until Clerk is configured.',
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{tree}</StrictMode>,
)
