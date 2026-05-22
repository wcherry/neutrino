'use client';

/**
 * Google Calendar OAuth callback page.
 *
 * Google redirects the browser here after the user grants (or denies) consent.
 * The URL contains ?code=<auth_code>&state=<state> (or ?error=access_denied).
 *
 * Because this is a browser navigation there is no Authorization header.
 * This page reads the code from the URL, then POSTs it to the authenticated
 * backend endpoint /api/v1/connections/google/complete using the JWT that is
 * already stored in localStorage.  After success the user is redirected back
 * to the calendar settings page.
 */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { calendarApi } from '@/lib/api';

export default function GoogleOAuthCallbackPage() {
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
          ? 'You declined the Google Calendar permission request.'
          : `Google returned an error: ${error}`
      );
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMessage('No authorization code received from Google.');
      return;
    }

    calendarApi
      .completeGoogleOAuth(code)
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
          err instanceof Error ? err.message : 'Failed to connect Google Calendar.'
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
            Connecting Google Calendar&hellip;
          </p>
        </>
      )}

      {status === 'success' && (
        <>
          <p style={{ fontSize: '1.1rem', color: '#22c55e', fontWeight: 600 }}>
            Google Calendar connected successfully.
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
