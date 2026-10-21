import type { Metadata, Viewport } from 'next';
import '@neutrino/ui/styles';
import './fonts';
import { ToastProvider } from '@neutrino/ui';
import { AuthProvider } from '@neutrino/auth';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { FeatureFlagsProvider } from '@/providers/FeatureFlagsProvider';
import { CustomFontsProvider } from '@/providers/CustomFontsProvider';
import { CustomThemesProvider } from '@/providers/CustomThemesProvider';
import { E2ECryptoExpose } from '@/components/E2ECryptoExpose';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { APP_IDS } from '@/lib/appForPath';
import { BOOT_KEY } from '@neutrino/preferences';

export const metadata: Metadata = {
  title: {
    default: 'Neutrino — Cloud Storage',
    template: '%s | Neutrino',
  },
  description: 'Secure cloud storage for individuals and teams.',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <body>
        <E2ECryptoExpose />
        <ServiceWorkerRegister />
        <ThemeProvider>
          <FeatureFlagsProvider>
            <CustomFontsProvider>
              <CustomThemesProvider>
                <QueryProvider>
                  <AuthProvider>
                    <ToastProvider position="bottom-right">
                      {children}
                    </ToastProvider>
                  </AuthProvider>
                </QueryProvider>
              </CustomThemesProvider>
            </CustomFontsProvider>
          </FeatureFlagsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
