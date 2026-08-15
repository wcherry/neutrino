'use client';

/**
 * A way to re-open `E2EEUnlockGate` from elsewhere in the app.
 *
 * The gate checks the vault once, when the app shell mounts, and a user who
 * dismisses it has no way back to it short of a reload — which is how someone
 * ends up in Settings looking at a key the app says is missing, with no button
 * that fixes it. Anything that notices a locked or unprovisioned session can
 * call `requestEncryptionGate()` and the gate re-runs its check.
 *
 * Deliberately an event rather than a prop: the gate lives in the `(apps)`
 * layout and the callers are pages nested inside it.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Ask the mounted gate to re-check the vault and show itself. */
export function requestEncryptionGate(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // One broken listener must not stop the gate hearing about the request.
    }
  });
}

export function subscribeToGateRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
