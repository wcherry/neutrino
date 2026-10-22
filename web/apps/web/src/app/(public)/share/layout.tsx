import { QueryProvider } from '@/providers/QueryProvider';

/** The only signed-out page that queries the API. */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
