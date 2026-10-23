import '@neutrino/ui/styles';
import '../fonts';
import { RootDocument, ROOT_METADATA, ROOT_VIEWPORT } from '../RootDocument';
import { AppProviders } from '@/providers/AppProviders';

export const metadata = ROOT_METADATA;
export const viewport = ROOT_VIEWPORT;

/** The presenter's second window: the signed-in providers (custom fonts, themes), no app shell. */
export default function MirrorRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootDocument>
      <AppProviders>{children}</AppProviders>
    </RootDocument>
  );
}
