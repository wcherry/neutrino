import '@neutrino/ui/styles';
import '../fonts';
import { RootDocument, ROOT_METADATA, ROOT_VIEWPORT } from '../RootDocument';
import { PublicServiceWorker } from './PublicRuntime';

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

/**
 * The signed-out pages — the landing page, sign-in, register, self-host and share links. None of
 * them uses the app's providers (auth, feature flags, custom fonts and themes, toasts), so none
 * is mounted: the anti-FOUC script in `RootDocument` applies the theme, and `/share`, the one
 * page that queries, brings its own query client. The service worker registers here too, so a
 * first visit to sign-in still installs the offline shell. Client components here come from
 * `PublicRuntime.tsx`, never from the other roots (it says why).
 */
export default function PublicRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootDocument>
      <PublicServiceWorker />
      {children}
    </RootDocument>
  );
}
