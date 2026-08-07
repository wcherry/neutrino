'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
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
      setError(err instanceof Error ? err.message : 'Sign in failed');
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
