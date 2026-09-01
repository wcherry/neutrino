'use client';

/**
 * Outlook / Microsoft 365 OAuth callback page.
 *
 * Microsoft redirects the browser here after the user grants (or denies) consent.
 * The URL contains ?code=<auth_code>&state=<state> (or ?error=access_denied).
 *
 * This is the Google callback page's counterpart, and it exists for the same
 * reason: a browser navigation carries no Authorization header, so the redirect
 * cannot land on an authenticated API route. It used to (issue #159), which
 * answered Microsoft with a 401 the moment consent succeeded. The page reads the
 * code from the URL and POSTs it to
 * /api/v1/calendar/connections/outlook/complete with the JWT already in
 * localStorage, then sends the user back to the calendar settings page.
 *
 * This page's own URL is the redirect URI the backend sends Microsoft, derived
 * from the origin the browser is on — so it is the URL an admin registers in the
 * Azure portal.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { calendarApi } from '@/lib/api';

export default function OutlookOAuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const error = searchParams.get('error');
    const code = searchParams.get('code');

    if (error) {
      setStatus('error');
      setErrorMessage(
        error === 'access_denied'
          ? 'You declined the Outlook Calendar permission request.'
          : `Microsoft returned an error: ${error}`
      );
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMessage('No authorization code received from Microsoft.');
      return;
    }

    calendarApi
      .completeOutlookOAuth(code)
      .then(() => {
        setStatus('success');
        // Give the user a moment to see the success state, then navigate back.
        setTimeout(() => {
          router.replace('/calendar/settings');
        }, 1500);
      })
      .catch((err: unknown) => {
        setStatus('error');
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to connect Outlook Calendar.'
        );
      });
  }, [searchParams, router]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1rem',
        fontFamily: 'sans-serif',
      }}
    >
      {status === 'pending' && (
        <>
          <p style={{ fontSize: '1.1rem', color: '#555' }}>
            Connecting Outlook Calendar&hellip;
          </p>
        </>
      )}

      {status === 'success' && (
        <>
          <p style={{ fontSize: '1.1rem', color: '#22c55e', fontWeight: 600 }}>
            Outlook Calendar connected successfully.
          </p>
          <p style={{ color: '#888' }}>Redirecting back to settings&hellip;</p>
        </>
      )}

      {status === 'error' && (
        <>
          <p style={{ fontSize: '1.1rem', color: '#ef4444', fontWeight: 600 }}>
            Connection failed
          </p>
          <p style={{ color: '#555', maxWidth: '400px', textAlign: 'center' }}>
            {errorMessage}
          </p>
          <button
            onClick={() => router.replace('/calendar/settings')}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '0.9rem',
            }}
          >
            Back to Settings
          </button>
        </>
      )}
    </div>
  );
}
