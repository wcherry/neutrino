/**
 * Default label for a newly enrolled passkey.
 *
 * Shared by every surface that enrols one (registration, settings) so a user
 * reading the list months later sees the same naming everywhere.
 */
export function defaultPasskeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Passkey';
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iOS passkey';
  if (/Macintosh/.test(ua)) return 'Mac passkey';
  if (/Windows/.test(ua)) return 'Windows passkey';
  if (/Android/.test(ua)) return 'Android passkey';
  return 'Passkey';
}
