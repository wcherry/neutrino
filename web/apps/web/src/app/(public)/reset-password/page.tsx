'use client';

import { Info } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiClientError } from '@neutrino/api-core';
import { authApi } from '@neutrino/auth';
import { BrandRow } from '../sign-in/BrandRow';
import styles from '../sign-in/page.module.css';

/**
 * Where `/reset-password?token=<token>` stands. `checking` holds the page until the server has
 * said whether the link still works, so an expired link never shows a form that cannot succeed.
 */
type LinkState =
  | { kind: 'checking' }
  | { kind: 'valid'; token: string; email: string; requiresTwoFactor: boolean }
  | { kind: 'invalid'; message: string }
  | { kind: 'done' };

/** What a link the server refused reads as. Unknown codes fall back to the server's message. */
function invalidMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case 'RESET_EXPIRED':
        return 'This reset link has expired. Ask for a new one.';
      case 'RESET_USED':
        return 'This reset link has already been used. Ask for a new one if you still need it.';
      case 'RESET_REVOKED':
        return 'A newer reset link has replaced this one. Use the link in the latest email, or ask for another.';
      case 'RESET_NOT_FOUND':
        return "This reset link isn't valid. Ask for a new one.";
    }
  }
  return err instanceof Error ? err.message : "This reset link can't be used.";
}

/** Codes that mean the link itself is no good, as opposed to what was typed into the form. */
const LINK_ERRORS = new Set(['RESET_EXPIRED', 'RESET_USED', 'RESET_REVOKED', 'RESET_NOT_FOUND', 'ACCOUNT_DISABLED']);

export default function ResetPasswordPage() {
  const [link, setLink] = useState<LinkState>({ kind: 'checking' });
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Read here rather than with useSearchParams so the static export needs no
    // Suspense boundary around the page.
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setLink({ kind: 'invalid', message: "This reset link isn't complete. Open it from the email again, or ask for a new one." });
      return;
    }
    let cancelled = false;
    authApi
      .checkPasswordReset(token)
      .then((check) => {
        if (!cancelled) setLink({ kind: 'valid', token, ...check });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLink({ kind: 'invalid', message: invalidMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (link.kind !== 'valid') return;
    if (newPassword !== confirm) {
      setError('The two passwords do not match');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authApi.resetPassword({
        token: link.token,
        newPassword,
        totpCode: totpCode.trim() || undefined,
      });
      setLink({ kind: 'done' });
    } catch (err: unknown) {
      if (err instanceof ApiClientError && LINK_ERRORS.has(err.code)) {
        setLink({ kind: 'invalid', message: invalidMessage(err) });
      } else {
        // The policy's own message names the rule that was broken, and repeating
        // it verbatim is how the user learns what the policy is.
        setError(err instanceof Error ? err.message : 'Could not reset the password');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <BrandRow />
        <h1 className={styles.heading}>
          {link.kind === 'done' ? 'Password changed' : 'Choose a new password'}
        </h1>

        {link.kind === 'checking' && <p className={styles.sub}>Checking your reset link…</p>}

        {link.kind === 'invalid' && (
          <>
            <p className={styles.notice} role="alert">
              <Info size={16} aria-hidden="true" />
              <span>{link.message}</span>
            </p>
            <Link href="/forgot-password" className={`${styles.submit} ${styles.linkButton}`}>
              Send a new link
            </Link>
          </>
        )}

        {link.kind === 'done' && (
          <>
            <p className={styles.sub}>
              Your password has been reset and every device has been signed out. Sign in with the
              new password to continue.
            </p>
            <Link href="/sign-in" className={`${styles.submit} ${styles.linkButton}`}>
              Sign in
            </Link>
          </>
        )}

        {link.kind === 'valid' && (
          <>
            <p className={styles.sub}>
              For <strong>{link.email}</strong>. Every device signed in to this account will be
              signed out. Your encrypted files aren&apos;t affected.
            </p>
            <form className={styles.form} onSubmit={handleSubmit}>
              {/* Lets a password manager file the new password under the right account. */}
              <input type="email" name="username" autoComplete="username" value={link.email} readOnly hidden />
              <div className={styles.field}>
                <label htmlFor="new-password" className={styles.label}>New password</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={styles.input}
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="confirm-password" className={styles.label}>Confirm new password</label>
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className={styles.input}
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {/* Only for accounts that have it: the link already proves the mailbox, so
                  saying whether this account uses two-factor tells nobody new anything. */}
              {link.requiresTwoFactor && (
                <div className={styles.field}>
                  <label htmlFor="totp-code" className={styles.label}>Two-factor code</label>
                  <input
                    id="totp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    className={styles.input}
                    placeholder="123456"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                  />
                </div>
              )}
              {error && <p className={styles.error}>{error}</p>}
              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? 'Saving…' : 'Set new password'}
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
