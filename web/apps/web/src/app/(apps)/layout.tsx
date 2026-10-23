import '@neutrino/ui/styles';
import '../fonts';
import { RootDocument, ROOT_METADATA, ROOT_VIEWPORT } from '../RootDocument';
import { AppProviders } from '@/providers/AppProviders';
import { AppShellLayout } from './AppShellLayout';

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

export default function AppsRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootDocument>
      <AppProviders>
        <AppShellLayout>{children}</AppShellLayout>
      </AppProviders>
    </RootDocument>
  );
}
