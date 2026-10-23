import type { Metadata } from 'next';
import '@neutrino/ui/styles';
import { RootDocument } from './RootDocument';
import styles from './global-not-found.module.css';

export const metadata: Metadata = { title: 'Page not found | Neutrino' };

/**
 * The 404 page, with its own document. With three root layouts and no `app/layout.tsx`, Next
 * otherwise renders its default 404 inside one of them, chosen by the build — and that layout's
 * script then rides along on every page's HTML, which put the whole signed-in provider stack
 * back on `/sign-in`.
 */
export default function GlobalNotFound() {
  return (
    <RootDocument>
      <main className={styles.page}>
        <h1 className={styles.title}>Page not found</h1>
        <p className={styles.text}>The page you asked for does not exist or has moved.</p>
        <a className={styles.link} href="/drive">Go to Drive</a>
      </main>
    </RootDocument>
  );
}
