'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authApi } from '@neutrino/auth';
import styles from './EmailVerificationBanner.module.css';

export const EMAIL_VERIFICATION_QUERY_KEY = ['email-verification'] as const;

/** Hidden for the rest of the tab's life once dismissed, unless sign-in is about to stop. */
const DISMISSED_KEY = 'neutrino.emailVerification.dismissed';

function readDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** "12 November" — the date sign-in stops, in the viewer's own calendar. */
function formatDeadline(blockAt: string): string {
  // The server sends naive UTC.
  const at = new Date(blockAt.endsWith('Z') ? blockAt : `${blockAt}Z`);
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

/**
 * Asks an account that has not proved its address to follow the emailed link.
 *
 * Shown only where the server sends links (`mode` is not `off`). Under
 * `enforce` it says what waits for the link — sharing, password reset — and
 * the date sign-in stops; within three days of that it cannot be dismissed.
 */
export function EmailVerificationBanner() {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const { data } = useQuery({
    queryKey: EMAIL_VERIFICATION_QUERY_KEY,
    queryFn: () => authApi.getEmailVerification(),
    staleTime: 5 * 60_000,
    // Following the link happens in another tab; coming back should drop the banner.
    refetchOnWindowFocus: true,
  });

  if (!data || data.verified || data.mode === 'off') return null;

  const enforced = data.mode === 'enforce';
  const daysLeft = data.blockAt
    ? Math.ceil((new Date(data.blockAt.endsWith('Z') ? data.blockAt : `${data.blockAt}Z`).getTime() - Date.now()) / 86_400_000)
    : null;
  const urgent = daysLeft !== null && daysLeft <= 3;
  if (dismissed && !urgent) return null;

  async function resend() {
    setError(null);
    setSending(true);
    try {
      await authApi.resendEmailVerification();
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send the email');
    } finally {
      setSending(false);
    }
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode: dismissing still hides it until the next load.
    }
    setDismissed(true);
  }

  return (
    <div className={styles.banner} role="region" aria-label="Verify your email address">
      <div className={styles.title}>Verify your email address</div>
      <p className={styles.detail}>
        We sent a link to <strong>{data.email}</strong>.
        {enforced && ' Until you follow it, you can’t share files or reset your password.'}
        {data.blockAt && ` Verify by ${formatDeadline(data.blockAt)} to keep signing in.`}
      </p>
      {error && <p className={styles.detail} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={resend} disabled={sending || sent}>
          {sent ? 'Email sent' : sending ? 'Sending…' : 'Resend email'}
        </button>
        {!urgent && (
          <button type="button" className={styles.dismiss} onClick={dismiss}>
            Not now
          </button>
        )}
      </div>
    </div>
  );
}
