'use client';

import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authApi } from '@/lib/api';
import { EncryptionSetupDialog } from '@/components/EncryptionSetupDialog';
import styles from '../sign-in/page.module.css';

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set once the account exists and is signed in; the encryption setup dialog
  // mints the key here rather than after the redirect so it exists before the
  // user has anything to encrypt.
  const [newUser, setNewUser] = useState<{ id: string; email: string } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Only flagged once the user has typed something to compare against, so the field
  // is not red the moment it gains focus.
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    const form = e.currentTarget;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const email = (form.elements.namedItem('email') as HTMLInputElement).value;

    try {
      const profile = await authApi.register({ name, email, password });
      await authApi.login({ email, password });
      setNewUser({ id: profile.id, email: profile.email });
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
            <div className={styles.passwordWrap}>
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                className={styles.input}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label htmlFor="confirmPassword" className={styles.label}>Confirm password</label>
            <div className={styles.passwordWrap}>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                className={`${styles.input} ${mismatch ? styles.inputInvalid : ''}`}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={mismatch}
                aria-describedby={mismatch ? 'confirmPassword-error' : undefined}
              />
              <button
                type="button"
                className={styles.reveal}
                onClick={() => setShowConfirmPassword((v) => !v)}
                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showConfirmPassword}
              >
                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {mismatch && (
              <p id="confirmPassword-error" className={styles.fieldError}>
                Passwords do not match
              </p>
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <button type="submit" className={styles.submit} disabled={loading || mismatch}>
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

      {newUser && (
        <EncryptionSetupDialog
          userId={newUser.id}
          userEmail={newUser.email}
          accountPassword={password}
          onDone={() => router.push('/drive')}
        />
      )}
    </div>
  );
}
