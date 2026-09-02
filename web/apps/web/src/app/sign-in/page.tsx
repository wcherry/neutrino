'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ApiClientError } from '@neutrino/api-core';
import { authApi } from '@/lib/api';
import { routeAfterSignIn, SIGN_IN_NEXT_PARAM } from '@/lib/signInRedirect';
import styles from './page.module.css';

export default function SignInPage() {
  // `useSearchParams` needs a Suspense boundary above it during prerender.
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /**
   * The credentials sign-in accepted but refused to issue tokens for, because
   * the password has expired.
   *
   * Set, the card becomes a change-password form. Holding the password rather
   * than asking for it again is what makes this one step instead of two: the
   * user has just typed it, and the change needs it as proof.
   */
  const [expired, setExpired] = useState<{ email: string; password: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      await authApi.login({ email, password });
      // Returns to whatever the user was trying to open, when they arrived from a link that
      // required signing in first. `routeAfterSignIn` drops anything that is not a path on this
      // site, so `?next=` cannot bounce them off-origin.
      router.push(routeAfterSignIn(searchParams.get(SIGN_IN_NEXT_PARAM)));
    } catch (err: unknown) {
      // An expired password is not a failed sign-in: the password was right,
      // and there is something the user can do about it here rather than
      // having to find an administrator.
      if (err instanceof ApiClientError && err.code === 'PASSWORD_EXPIRED') {
        setExpired({ email, password });
      } else {
        setError(err instanceof Error ? err.message : 'Sign in failed');
      }
    } finally {
      setLoading(false);
    }
  }

  if (expired) {
    return (
      <ExpiredPasswordForm
        credentials={expired}
        onCancel={() => setExpired(null)}
        onChanged={() =>
          // Changing a password revokes every session, this one included, so
          // there is nothing to redirect into — they sign in again with it.
          setExpired(null)
        }
      />
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoRow}>
          <div className={styles.logoMark}>N</div>
          <span className={styles.logoText}>Neutrino</span>
        </div>
        <h1 className={styles.heading}>Welcome back</h1>
        <p className={styles.sub}>Sign in to your account</p>

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
          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={styles.input}
              placeholder="••••••••"
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className={styles.footer}>
          Don&apos;t have an account?{' '}
          <Link href="/register" className={styles.footerLink}>
            Create one free
          </Link>
        </p>
        <p className={styles.footer}>
          <Link href="/" className={styles.footerLink}>
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * What a `PASSWORD_EXPIRED` sign-in turns into.
 *
 * An admin has expired this password, or the workspace policy's maximum age has
 * passed. The account is otherwise fine, so the way through is to set a new
 * password here rather than to go and find someone — which is the difference
 * between an expiry and a lock-out.
 */
function ExpiredPasswordForm({
  credentials,
  onCancel,
  onChanged,
}: {
  credentials: { email: string; password: string };
  onCancel: () => void;
  onChanged: () => void;
}) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError('The two passwords do not match');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await authApi.changePassword({
        email: credentials.email,
        currentPassword: credentials.password,
        newPassword,
        totpCode: totpCode.trim() || undefined,
      });
      setDone(true);
    } catch (err: unknown) {
      // The policy's own message names the rule that was broken, and repeating
      // it verbatim is how the user learns what the policy is.
      setError(err instanceof Error ? err.message : 'Could not change the password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoRow}>
          <div className={styles.logoMark}>N</div>
          <span className={styles.logoText}>Neutrino</span>
        </div>
        <h1 className={styles.heading}>Set a new password</h1>
        <p className={styles.sub}>
          {done
            ? 'Your password has been changed. Sign in with it to continue.'
            : 'Your password has expired. Choose a new one to sign in.'}
        </p>

        {done ? (
          <button type="button" className={styles.submit} onClick={onChanged}>
            Back to sign in
          </button>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
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
            {/* Shown always rather than only for accounts that have two-factor:
                finding out which would need a call that tells anyone who asks
                whether an address has 2FA on it. Left blank it is not sent. */}
            <div className={styles.field}>
              <label htmlFor="totp-code" className={styles.label}>
                Two-factor code (if you use one)
              </label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className={styles.input}
                placeholder="123456"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
              />
            </div>
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className={styles.submit} disabled={loading}>
              {loading ? 'Saving…' : 'Set password'}
            </button>
          </form>
        )}

        <p className={styles.footer}>
          <button type="button" className={styles.footerLink} onClick={onCancel}>
            ← Back to sign in
          </button>
        </p>
      </div>
    </div>
  );
}
