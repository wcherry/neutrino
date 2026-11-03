'use client';

import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { authApi } from '@neutrino/auth';
import { BrandRow } from '../sign-in/BrandRow';
import styles from '../sign-in/page.module.css';

/**
 * "Forgot password?": asks for the account's address and has a reset link mailed to it.
 *
 * The confirmation reads the same whether or not the address has an account — the server answers
 * both alike so this form cannot be used to find out who has one, and the page must not undo that
 * by saying more than it was told.
 */
export default function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value.trim();
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the reset link');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandRow />
        <h1 className={styles.heading}>Reset your password</h1>

        {sentTo ? (
          <>
            <p className={styles.notice} role="status">
              <MailCheck size={16} aria-hidden="true" />
              <span>
                If <strong>{sentTo}</strong> has an account, a link to reset its password is on its
                way. It works once and expires in an hour.
              </span>
            </p>
            <p className={styles.sub}>
              Nothing after a few minutes? Check your spam folder, or make sure you used the
              address you sign in with.
            </p>
            <button type="button" className={styles.submit} onClick={() => setSentTo(null)}>
              Try another address
            </button>
          </>
        ) : (
          <>
            <p className={styles.sub}>
              Enter the email you sign in with and we&apos;ll send you a link to choose a new
              password. Your encrypted files aren&apos;t affected.
            </p>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="email" className={styles.label}>Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className={styles.input}
                  placeholder="you@example.com"
                />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}

        <p className={styles.footer}>
          <Link href="/sign-in" className={styles.footerLink}>
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
