import { useEffect, useState } from 'react';
import { APPLE_SIGN_IN, authClient } from '../lib/authClient';
import { PROVIDER_NAMES, linkReturnURL, type LinkProvider } from '../lib/accountLinks';
import { useOnPageRestore } from '../lib/pageRestore';
import { AppleLogo, GoogleLogo } from './ProviderLogos';

const LOGOS: Record<LinkProvider, () => React.JSX.Element> = {
  google: GoogleLogo,
  apple: AppleLogo,
};

/**
 * The ways into this account, in the account menu: Google and Apple (once
 * it's set up), each connected or with Connect, which goes to Google or
 * Apple and comes back here (accountLinks.ts says how it went). Then
 * either signs in to this same account, whatever its email, so one signed
 * in with a passkey or Google can add the other ways. Read only while the
 * menu is open.
 */
export function SignInMethods() {
  const [linked, setLinked] = useState<ReadonlySet<string> | null>(null);
  const [unread, setUnread] = useState(false);
  const [connecting, setConnecting] = useState<LinkProvider | null>(null);
  const [failed, setFailed] = useState<LinkProvider | null>(null);
  // Back from Google's or Apple's page without connecting.
  useOnPageRestore(() => setConnecting(null));
  useEffect(() => {
    void authClient.listAccounts().then(({ data, error }) => {
      if (error) setUnread(true);
      else setLinked(new Set(data.map((account) => account.providerId)));
    });
  }, []);

  async function connect(provider: LinkProvider) {
    setConnecting(provider);
    setFailed(null);
    const here = window.location.href;
    const started = await authClient
      .linkSocial({
        provider,
        callbackURL: linkReturnURL(here, provider, 'linked'),
        errorCallbackURL: linkReturnURL(here, provider, 'link-failed'),
      })
      .then(
        ({ error }) => !error,
        () => false,
      );
    // Started, the browser is on its way to Google or Apple.
    if (!started) {
      setConnecting(null);
      setFailed(provider);
    }
  }

  const quiet = 'px-md py-sm font-body-md text-body-sm text-on-surface-variant';
  if (unread) return <p className={quiet}>Your sign-in methods couldn’t be loaded.</p>;
  if (!linked) return <p className={quiet}>Loading your sign-in methods…</p>;
  const providers: LinkProvider[] = APPLE_SIGN_IN ? ['google', 'apple'] : ['google'];
  return (
    <>
      <ul aria-label="Your sign-in methods">
        {providers.map((provider) => {
          const Logo = LOGOS[provider];
          const name = PROVIDER_NAMES[provider];
          return (
            <li key={provider} className="flex min-h-11 items-center gap-sm px-md py-xs">
              <Logo />
              <span className="flex-1 font-body-md text-body-sm text-on-surface">{name}</span>
              {linked.has(provider) ? (
                <span className="font-body-md text-body-sm text-on-surface-variant">Connected</span>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect(provider)}
                  disabled={connecting !== null}
                  aria-label={`Connect ${name}`}
                  className="rounded-full px-sm py-xs font-body-md text-body-sm text-primary transition-colors hover:bg-surface-container-low disabled:opacity-50"
                >
                  {connecting === provider ? 'Opening…' : 'Connect'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {failed && (
        <p role="alert" className="px-md py-xs font-body-md text-body-sm text-error">
          Connecting {PROVIDER_NAMES[failed]} didn’t start. Try again.
        </p>
      )}
    </>
  );
}
