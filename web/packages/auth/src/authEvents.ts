'use client';

/**
 * Sign-in / sign-out notifications for `AuthProvider`.
 *
 * The provider loads the profile once, when it mounts — which on `/sign-in` and
 * `/register` happens *before* there is a token. Both pages then move on with
 * `router.push`, a client-side navigation that leaves the provider mounted, so
 * without this every consumer of `useAuth()` sees `user: null` for the rest of
 * the session. That is not a cosmetic gap: the editors read `user.id` to load
 * the E2EE key, so a freshly signed-in user could not encrypt or decrypt
 * anything until they happened to reload the page.
 *
 * Emitted from `authApi.login`/`logout` — the two places tokens change — rather
 * than from the pages, so a new sign-in path cannot forget to announce itself.
 * A `storage` event would not do: it does not fire in the tab that wrote.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Announce that the stored tokens changed. */
export function emitAuthChanged(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // A broken listener must not stop the others hearing about a sign-in.
    }
  });
}

export function subscribeToAuthChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
