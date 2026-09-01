/**
 * The DEK has to be resolvable *after* mount.
 *
 * `E2EEUnlockGate` is an overlay, not a hard gate, so an editor routinely
 * mounts while the vault is still locked — reloading the page on /docs/editor
 * does it every time. Resolving the key once on mount left that page keyless
 * for its whole life: every autosave threw `no-dek` and warned "Changes not
 * saved — encryption key unavailable", while the Yjs collab room quietly kept
 * the text, which is why the document still looked saved.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Controllable lock state ──────────────────────────────────────────────────

let unlocked = false;
const lockListeners = new Set<() => void>();

function setUnlocked(next: boolean) {
  unlocked = next;
  lockListeners.forEach((l) => l());
}

vi.mock('@neutrino/e2e-crypto', () => ({
  initSodium: vi.fn(() => Promise.resolve()),
  loadKeyPair: vi.fn(() =>
    unlocked ? { publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) } : null,
  ),
  openSealedFileKey: vi.fn(() => new Uint8Array([9, 9, 9])),
  activeKeyVersion: vi.fn(() => 1),
  generateFileKey: vi.fn(() => new Uint8Array([7])),
  encryptFileKey: vi.fn(() => 'sealed'),
  isUnlocked: () => unlocked,
  subscribeToLockState: (listener: () => void) => {
    lockListeners.add(listener);
    return () => lockListeners.delete(listener);
  },
}));

vi.mock('@neutrino/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isLoading: false }),
}));

const getFileKey = vi.fn(() => Promise.resolve({ encryptedFileKey: 'sealed' }));
const setFileKey = vi.fn(() => Promise.resolve());

vi.mock('@/lib/api', () => ({
  encryptionApi: {
    getFileKey: (...args: unknown[]) => getFileKey(...(args as [])),
    setFileKey: (...args: unknown[]) => setFileKey(...(args as [])),
  },
  driveAutosaveContent: vi.fn(),
  driveAutosaveEncryptedContent: vi.fn(() => Promise.resolve()),
  driveCreateVersion: vi.fn(),
  driveCreateEncryptedVersion: vi.fn(),
}));

import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';

function renderEncryptedContent() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return renderHook(
    () => useEncryptedDocumentContent({ id: 'doc-1', filename: 'doc.json' }),
    { wrapper },
  );
}

describe('useEncryptedDocumentContent — unlocking after mount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` forgets the calls, not the implementations — put the
    // default answers back so a test that stubs one does not leak into the next.
    getFileKey.mockResolvedValue({ encryptedFileKey: 'sealed' });
    setFileKey.mockResolvedValue(undefined);
    unlocked = false;
    lockListeners.clear();
  });

  it('picks the key up when the vault is unlocked after the editor mounted', async () => {
    const { result } = renderEncryptedContent();

    // Locked: resolution settles with no key, so callers fall back to plaintext.
    await waitFor(() => expect(result.current.dekResolved).toBe(true));
    expect(result.current.dekRef.current).toBeNull();
    expect(getFileKey).not.toHaveBeenCalled();

    await act(async () => {
      setUnlocked(true);
    });

    await waitFor(() => expect(result.current.dekRef.current).not.toBeNull());
    expect(getFileKey).toHaveBeenCalledWith('doc-1');
    // The content on screen was read as plaintext while we had no key, so the
    // caller's query — keyed on dekResolved — has to re-run.
    await waitFor(() => expect(result.current.dekResolved).toBe(true));
  });

  it('does not re-fetch the file key on an unrelated lock notification', async () => {
    unlocked = true;
    const { result } = renderEncryptedContent();

    await waitFor(() => expect(result.current.dekRef.current).not.toBeNull());
    expect(getFileKey).toHaveBeenCalledTimes(1);

    await act(async () => {
      lockListeners.forEach((l) => l());
    });

    expect(getFileKey).toHaveBeenCalledTimes(1);
  });

  it('awaitDek waits for an in-flight resolution instead of reporting no key', async () => {
    unlocked = true;
    let releaseKey: (v: { encryptedFileKey: string }) => void = () => {};
    getFileKey.mockImplementationOnce(
      () => new Promise((resolve) => { releaseKey = resolve; }),
    );

    const { result } = renderEncryptedContent();
    await waitFor(() => expect(getFileKey).toHaveBeenCalled());

    // A save fired while the key is still in flight — dekRef is still null here.
    expect(result.current.dekRef.current).toBeNull();
    const pending = result.current.awaitDek();

    await act(async () => {
      releaseKey({ encryptedFileKey: 'sealed' });
    });

    await expect(pending).resolves.not.toBeNull();
  });

  /**
   * The resolution that minted the key was cancelled, so it never reported
   * itself resolved — and the run that replaced it found the key already in
   * hand and returned early. Nothing was left to set the flag, and every
   * caller gated on it waited forever: the note editor rendered its toolbar
   * and no blocks at all.
   */
  it('reports resolved when a re-run finds the key a cancelled resolution left behind', async () => {
    unlocked = true;
    getFileKey.mockResolvedValue(null as never);
    const settleWrites: Array<() => void> = [];
    setFileKey.mockImplementation(
      () => new Promise<void>((resolve) => { settleWrites.push(() => resolve()); }),
    );

    const { result } = renderEncryptedContent();
    await waitFor(() => expect(settleWrites.length).toBe(1));

    // A lock notification cancels that first resolution and starts a second.
    await act(async () => { lockListeners.forEach((l) => l()); });
    await waitFor(() => expect(settleWrites.length).toBe(2));
    expect(result.current.dekResolved).toBe(false);

    // The cancelled one lands anyway: the key is written to the ref, but its
    // `finally` stays quiet because it was cancelled.
    await act(async () => { settleWrites[0](); });

    // The next notification therefore finds a key already resolved for this
    // file and has nothing to fetch — it still has to say so.
    await act(async () => { lockListeners.forEach((l) => l()); });
    await waitFor(() => expect(result.current.dekResolved).toBe(true));
    expect(result.current.dekRef.current).not.toBeNull();
  });

  it('drops the key when the session locks', async () => {
    unlocked = true;
    const { result } = renderEncryptedContent();

    await waitFor(() => expect(result.current.dekRef.current).not.toBeNull());

    await act(async () => {
      setUnlocked(false);
    });

    await waitFor(() => expect(result.current.dekRef.current).toBeNull());
  });
});
