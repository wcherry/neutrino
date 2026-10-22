import { ShareQueryProvider } from './ShareQueryProvider';

/** The only signed-out page that queries the API. */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <ShareQueryProvider>{children}</ShareQueryProvider>;
}
