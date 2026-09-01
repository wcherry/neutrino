import type { ConnectionProvider } from '@/lib/api';

export const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  google: 'Google Calendar',
  outlook: 'Outlook / Microsoft 365',
  apple: 'Apple Calendar (iCloud)',
};

/**
 * What to show when "Connect" fails on the Calendar tab.
 *
 * The server's own message is the useful half and is passed through rather than
 * replaced by a generic string: a self-hosted deployment that never set
 * `OUTLOOK_CLIENT_ID` gets told exactly which variable is missing, instead of
 * being left to find it in the container logs. That was issue #159 — the connect
 * mutations had no `onError` at all, so a 400 from the server produced nothing
 * on screen, not even a failure.
 */
export function connectFailureMessage(provider: ConnectionProvider, err: unknown): string {
  const detail = err instanceof Error && err.message.trim() ? err.message.trim() : '';
  const label = PROVIDER_LABELS[provider];
  return detail
    ? `Could not connect ${label}: ${detail}`
    : `Could not connect ${label}. Please try again.`;
}
