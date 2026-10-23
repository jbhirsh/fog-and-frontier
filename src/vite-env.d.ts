// The VITE_ variables the client reads. vite/client types any other key on
// import.meta.env as `any`, so each one the app uses is declared here.
interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_OWNER_EMAILS?: string;
  readonly VITE_CARTO_API_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_VERCEL_ENV?: string;
  readonly VITE_VERCEL_GIT_COMMIT_SHA?: string;
}
