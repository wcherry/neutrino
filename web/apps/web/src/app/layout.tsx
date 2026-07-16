import type { Metadata, Viewport } from 'next';
import '@neutrino/ui/styles';
import { ToastProvider } from '@neutrino/ui';
import { AuthProvider } from '@neutrino/auth';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { FeatureFlagsProvider } from '@/providers/FeatureFlagsProvider';
import { CustomFontsProvider } from '@/providers/CustomFontsProvider';
import { E2ECryptoExpose } from '@/components/E2ECryptoExpose';

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
    <html lang="en" data-app="drive" suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: resolves and applies theme before first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var v=['light','dark','system','glass','midnight','beach','forest','sunbeams','light-glass'];var t=localStorage.getItem('neutrino.theme')||'system';if(v.indexOf(t)<0)t='system';var r=t==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.setAttribute('data-theme',r);}catch(e){}})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto:wght@400;500;700&family=Open+Sans:wght@400;600;700&family=Lato:wght@400;700&family=Playfair+Display:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <E2ECryptoExpose />
        <ThemeProvider>
          <FeatureFlagsProvider>
            <CustomFontsProvider>
              <QueryProvider>
                <AuthProvider>
                  <ToastProvider position="bottom-right">
                    {children}
                  </ToastProvider>
                </AuthProvider>
              </QueryProvider>
            </CustomFontsProvider>
          </FeatureFlagsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
