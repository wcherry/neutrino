import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './legal.module.css';

/** Where privacy requests and questions about either policy go. */
export const CONTACT_EMAIL = 'support@getneutrino.app';

/** The day the current text of both policies took effect. Change it with the text. */
export const EFFECTIVE_DATE = 'November 2, 2026';

interface LegalPageProps {
  title: string;
  /** The other policy, linked from the foot of this one. */
  sibling: { href: string; label: string };
  children: ReactNode;
}

/**
 * The frame the Privacy Policy and Terms of Service share: a bar back to the landing page, the
 * title and effective date, the text, and links to the other policy. Both describe the hosted
 * service at getneutrino.app; a self-hosted server is its operator's to describe.
 */
export function LegalPage({ title, sibling, children }: LegalPageProps) {
  return (
    <div className={styles.page}>
      <header className={styles.bar}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>N</span>
          Neutrino
        </Link>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.effective}>Effective {EFFECTIVE_DATE}</p>
        <div className={styles.body}>{children}</div>
      </main>

      <footer className={styles.footer}>
        <Link href={sibling.href}>{sibling.label}</Link>
        <Link href="/">Home</Link>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </footer>
    </div>
  );
}
