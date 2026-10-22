import type { Metadata, Viewport } from 'next';
import { APP_IDS } from '@/lib/appForPath';
import { BOOT_KEY } from '@neutrino/preferences';

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
        {/* Anti-FOUC: resolves and applies the theme, and the app the route belongs to, before first paint */}
        <script
          dangerouslySetInnerHTML={{
            // The boot record is the preference store's mirror of every before-paint
            // preference (@neutrino/preferences, BOOT_KEY); the legacy theme key covers the
            // first load after an upgrade, before the migration has run.
            __html: `(function(){var b={};try{b=JSON.parse(localStorage.getItem('${BOOT_KEY}')||'{}')||{};}catch(e){}var d=document.documentElement;try{var l=b['appearance.look'];if(['classic','lightflow','precision','blended'].indexOf(l)>=0)d.setAttribute('data-look',l);var n=b['appearance.density'];if(['compact','comfortable','spacious'].indexOf(n)>=0)d.setAttribute('data-density',n);}catch(e){}try{var v=['light','dark','system','glass','midnight','beach','forest','sunbeams','light-glass'];var t=b['appearance.theme']||localStorage.getItem('neutrino.theme')||'system';if(v.indexOf(t)<0&&t.indexOf('custom-')!==0)t='system';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);}catch(e){}try{var a=${JSON.stringify(APP_IDS)};var s=location.pathname.split('/').filter(Boolean)[0]||'';document.documentElement.setAttribute('data-app',a.indexOf(s)>=0?s:'drive');}catch(e){}})();`,
          }}
        />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>{children}</body>
    </html>
  );
}
