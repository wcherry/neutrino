'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '@/lib/api';
import styles from '../sign-in/page.module.css';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = e.currentTarget;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('password') as HTMLInputElement).value;

    try {
      await authApi.register({ name, email, password });
      await authApi.login({ email, password });
      router.push('/drive');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
        <h1 className={styles.heading}>Create your account</h1>
        <p className={styles.sub}>Free forever · No credit card required</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label htmlFor="name" className={styles.label}>Name</label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              className={styles.input}
              placeholder="Your name"
            />
          </div>
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
              autoComplete="new-password"
              required
              minLength={8}
              className={styles.input}
              placeholder="At least 8 characters"
            />
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? 'Creating account…' : 'Create free account'}
          </button>
        </form>

        <p className={styles.footer}>
          Already have an account?{' '}
          <Link href="/sign-in" className={styles.footerLink}>
            Sign in
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
