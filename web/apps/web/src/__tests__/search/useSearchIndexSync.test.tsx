/**
 * Tests for the sync pass the app shell runs on mount and tab focus.
 *
 * The ordering is the point: pulling a snapshot before the local indexer runs
 * is what turns a new device's first search from "wait several minutes while
 * every document is fetched and decrypted" into an immediate one. Pushing last
 * is what makes the conflict rule safe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const {
  loadKeyPair,
  lockListeners,
  isSyncDue,
  syncSearchIndex,
  pullSnapshot,
  syncSnapshot,
  calls,
} = vi.hoisted(() => {
    const calls: string[] = [];
    return {
      calls,
      loadKeyPair: vi.fn(),
      // The hook re-checks the keyring whenever the session locks or unlocks;
      // `notifyUnlock` is how a test plays that transition.
      lockListeners: new Set<() => void>(),
      isSyncDue: vi.fn(),
      syncSearchIndex: vi.fn(async () => {
        calls.push('index');
        return { indexed: 0, removed: 0, skipped: 0 };
      }),
      pullSnapshot: vi.fn(async () => {
        calls.push('pull');
        return { status: 'none' as const };
      }),
      syncSnapshot: vi.fn(async () => {
        calls.push('push');
        return { pull: { status: 'none' as const }, push: { status: 'skipped' as const } };
      }),
    };
  });

vi.mock('@neutrino/e2e-crypto', () => ({
  loadKeyPair,
  subscribeToLockState: (listener: () => void) => {
    lockListeners.add(listener);
    return () => lockListeners.delete(listener);
  },
}));

/** Fire a lock-state transition, as unlocking the keyring does. */
function notifyUnlock() {
  lockListeners.forEach((l) => l());
}
vi.mock('@/lib/searchIndexer', () => ({ isSyncDue, syncSearchIndex }));
vi.mock('@/lib/searchIndexSnapshot', () => ({ pullSnapshot, syncSnapshot }));

async function freshHook() {
  // The module throttles across mounts with module-level state, so each test
  // needs its own copy to start from a clean slate.
  vi.resetModules();
  const { useSearchIndexSync } = await import('@/hooks/useSearchIndexSync');
  return useSearchIndexSync;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  lockListeners.clear();
  localStorage.clear();
  loadKeyPair.mockReturnValue({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
  isSyncDue.mockReturnValue(true);
});

describe('useSearchIndexSync', () => {
  it('pulls a snapshot, indexes locally, then shares the result', async () => {
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));

    await waitFor(() => expect(calls).toEqual(['pull', 'index', 'push']));
  });

  it('does nothing without a signed-in user', async () => {
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync(undefined));

    expect(pullSnapshot).not.toHaveBeenCalled();
    expect(syncSearchIndex).not.toHaveBeenCalled();
  });

  it('does nothing without E2EE keys on this device', async () => {
    // The index and the snapshot both hold decrypted text, so neither makes
    // sense on a device that cannot decrypt anything.
    loadKeyPair.mockReturnValue(null);
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));

    expect(pullSnapshot).not.toHaveBeenCalled();
    expect(syncSearchIndex).not.toHaveBeenCalled();
  });

  /**
   * The regression: the keyring is unwrapped from IndexedDB asynchronously, so
   * on a fresh load this hook's effect runs while the session is still locked.
   * Sampling `loadKeyPair` once and returning meant the sync never ran — and,
   * because the early return came first, the visibility listener was never
   * registered either, so nothing retried for the life of the page. The index
   * stayed empty and every search matched nothing.
   */
  it('syncs when the keyring is unlocked after mount', async () => {
    loadKeyPair.mockReturnValue(null);
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));

    expect(pullSnapshot).not.toHaveBeenCalled();

    loadKeyPair.mockReturnValue({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
    notifyUnlock();

    await waitFor(() => expect(calls).toEqual(['pull', 'index', 'push']));
  });

  it('stops listening for unlocks once unmounted', async () => {
    loadKeyPair.mockReturnValue(null);
    const useSearchIndexSync = await freshHook();
    const { unmount } = renderHook(() => useSearchIndexSync('user-1'));

    unmount();
    loadKeyPair.mockReturnValue({ publicKey: new Uint8Array(), secretKey: new Uint8Array() });
    notifyUnlock();

    expect(pullSnapshot).not.toHaveBeenCalled();
  });

  it('respects the Settings toggle that disables background syncing', async () => {
    localStorage.setItem('neutrino:search:syncDisabled', 'true');
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));

    expect(pullSnapshot).not.toHaveBeenCalled();
    expect(syncSearchIndex).not.toHaveBeenCalled();
  });

  it('still pulls and pushes when the local index is not due for a rebuild', async () => {
    // The snapshot exchange sits outside the local indexer's five-minute
    // throttle: another device's upload should land without waiting it out.
    isSyncDue.mockReturnValue(false);
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));

    await waitFor(() => expect(calls).toEqual(['pull', 'push']));
    expect(syncSearchIndex).not.toHaveBeenCalled();
  });

  it('runs once across concurrent mounts rather than racing itself', async () => {
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));
    renderHook(() => useSearchIndexSync('user-1'));

    await waitFor(() => expect(calls).toContain('push'));
    expect(pullSnapshot).toHaveBeenCalledTimes(1);
  });

  it('completes the local sync even when the snapshot pull fails', async () => {
    // A device that cannot reach the snapshot endpoint must still index; it
    // just pays the full cost of doing so.
    pullSnapshot.mockRejectedValueOnce(new Error('offline'));
    const useSearchIndexSync = await freshHook();
    renderHook(() => useSearchIndexSync('user-1'));

    await waitFor(() => expect(syncSearchIndex).toHaveBeenCalled());
  });

  it('does not surface a failed upload — the local index is already correct', async () => {
    syncSnapshot.mockRejectedValueOnce(new Error('server down'));
    const useSearchIndexSync = await freshHook();
    const { result } = renderHook(() => useSearchIndexSync('user-1'));

    await waitFor(() => expect(syncSnapshot).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });
});
