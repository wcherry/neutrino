import { ToastProvider } from '@neutrino/ui';
import { AuthProvider } from '@neutrino/auth';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { FeatureFlagsProvider } from '@/providers/FeatureFlagsProvider';
import { CustomFontsProvider } from '@/providers/CustomFontsProvider';
import { CustomThemesProvider } from '@/providers/CustomThemesProvider';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

/** Everything a signed-in page runs under: the `(apps)` and `(mirror)` roots. */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
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
    </>
  );
}
