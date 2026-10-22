import type { Metadata, Viewport } from 'next';
import { ANTI_FOUC_SCRIPT } from '@/lib/antiFouc';

/*
 * The document every root layout renders. There are three roots — `(public)` for the signed-out
 * pages, `(apps)` for the app shell, `(mirror)` for the presenter's second window — so that a
 * signed-out page loads only what it uses instead of the whole app's providers (P4 in
 * agent_docs/ui-performance-roadmap.md). Moving between roots is a full page load, which is only
 * ever signing in, signing out, or opening a share link into an editor.
 */

export const ROOT_METADATA: Metadata = {
  title: {
    default: 'Neutrino — Cloud Storage',
    template: '%s | Neutrino',
  },
  description: 'Secure cloud storage for individuals and teams.',
  icons: {
    icon: '/favicon.ico',
  },
};

export const ROOT_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    // `data-look` and `data-density` are the look-and-feel axes beside
    // `data-theme` (packages/tokens/src/looks.css, density.css); classic and
    // comfortable are today's UI until the preference registry sets them.
    <html lang="en" data-app="drive" data-look="classic" data-density="comfortable" suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: resolves and applies the theme, look, density and the route's app before first paint */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FOUC_SCRIPT }} />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>{children}</body>
    </html>
  );
}
