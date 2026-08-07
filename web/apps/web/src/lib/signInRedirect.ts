/**
 * Where to send a user after signing in.
 *
 * Exists for shared links: `/open/note/<id>`, a document URL pasted into an email, a Universal Link
 * followed on a device without the app. All of them routinely arrive signed-out, and dropping the
 * user on Drive after login loses the thing they were trying to open.
 */

export const SIGN_IN_NEXT_PARAM = 'next';

/** Where sign-in sends anyone who arrived without a destination. */
export const DEFAULT_SIGNED_IN_ROUTE = '/drive';

/**
 * The sign-in URL that will return to `destination`.
 *
 * A destination that is not a same-origin path is dropped rather than encoded, so nothing can
 * construct a sign-in link that bounces to another site.
 */
export function signInHref(destination: string): string {
  const safe = safeRedirect(destination);
  return safe ? `/sign-in?${SIGN_IN_NEXT_PARAM}=${encodeURIComponent(safe)}` : '/sign-in';
}

/**
 * Validates a `?next=` value, returning null for anything that is not a path on this site.
 *
 * The rules exist to close the open-redirect hole a naive `router.push(next)` would open:
 *
 * - It must start with `/` — no `https://evil.example.com`, no `javascript:`.
 * - It must not start with `//` or `/\`, which browsers read as protocol-relative URLs pointing at
 *   another host.
 */
export function safeRedirect(destination: string | null | undefined): string | null {
  if (!destination) return null;
  if (!destination.startsWith('/')) return null;
  if (destination.startsWith('//') || destination.startsWith('/\\')) return null;
  return destination;
}

/** The route to land on after a successful sign-in, given the `?next=` value seen on the page. */
export function routeAfterSignIn(next: string | null | undefined): string {
  return safeRedirect(next) ?? DEFAULT_SIGNED_IN_ROUTE;
}
