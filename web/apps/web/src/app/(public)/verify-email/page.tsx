'use client';

import { Info } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiClientError } from '@neutrino/api-core';
import { authApi } from '@neutrino/auth';
import { BrandRow } from '../sign-in/BrandRow';
import styles from '../sign-in/page.module.css';

/** Where `/verify-email?token=<token>` stands. The link is followed as soon as the page opens. */
type LinkState =
  | { kind: 'checking' }
  | { kind: 'verified'; email: string }
  | { kind: 'invalid'; message: string; alreadyVerified: boolean };

/** What a link the server refused reads as. Unknown codes fall back to the server's message. */
function invalidState(err: unknown): LinkState {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case 'VERIFY_USED':
        return {
          kind: 'invalid',
          message: 'This link has already been used, so your email address is verified.',
          alreadyVerified: true,
        };
      case 'VERIFY_EXPIRED':
        return {
          kind: 'invalid',
          message: 'This verification link has expired. Sign in to send a new one.',
          alreadyVerified: false,
        };
      case 'VERIFY_REVOKED':
        return {
          kind: 'invalid',
          message: 'A newer verification link has replaced this one. Use the link in the latest email.',
          alreadyVerified: false,
        };
      case 'VERIFY_NOT_FOUND':
        return {
          kind: 'invalid',
          message: "This verification link isn't valid. Sign in to send a new one.",
          alreadyVerified: false,
        };
    }
  }
  return {
    kind: 'invalid',
    message: err instanceof Error ? err.message : "This verification link can't be used.",
    alreadyVerified: false,
  };
}

export default function VerifyEmailPage() {
  const [link, setLink] = useState<LinkState>({ kind: 'checking' });

  useEffect(() => {
    // Read here rather than with useSearchParams so the static export needs no
    // Suspense boundary around the page.
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setLink({
        kind: 'invalid',
        message: "This verification link isn't complete. Open it from the email again.",
        alreadyVerified: false,
      });
      return;
    }
    let cancelled = false;
    authApi
      .verifyEmail(token)
      .then(({ email }) => {
        if (!cancelled) setLink({ kind: 'verified', email });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLink(invalidState(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandRow />
        <h1 className={styles.heading}>
          {link.kind === 'verified' ? 'Email address verified' : 'Verify your email address'}
        </h1>

        {link.kind === 'checking' && <p className={styles.sub}>Checking your link…</p>}

        {link.kind === 'verified' && (
          <>
            <p className={styles.sub} role="status">
              Thanks — <strong>{link.email}</strong> is verified.
            </p>
            <Link href="/drive" className={`${styles.submit} ${styles.linkButton}`}>
              Continue to Neutrino
            </Link>
          </>
        )}

        {link.kind === 'invalid' && (
          <>
            <p className={styles.notice} role="alert">
              <Info size={16} aria-hidden="true" />
              <span>{link.message}</span>
            </p>
            <Link
              href={link.alreadyVerified ? '/drive' : '/sign-in'}
              className={`${styles.submit} ${styles.linkButton}`}
            >
              {link.alreadyVerified ? 'Continue to Neutrino' : 'Sign in'}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
