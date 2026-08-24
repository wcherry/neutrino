'use client';

/**
 * useEncryptedDocumentContent
 *
 * Shared hook that encapsulates the common E2EE persistence flow used by the
 * Docs, Sheets, and Slides editors:
 *
 *   1. Resolve the per-file Data Encryption Key (DEK) from the user's key pair.
 *   2. Expose `autosave(content)` — writes an autosave revision (no version entry).
 *   3. Expose `createVersion(content)` — writes a named version snapshot.
 *   4. Expose `dekRef` and `dekResolved` so callers can read content themselves
 *      (via their own useQuery) while still using this hook's mutation helpers.
 *
 * Usage
 * -----
 *   const { dekRef, dekResolved, autosave, createVersion } =
 *     useEncryptedDocumentContent({ id: docId, filename: 'doc.json' });
 *
 *   // Read content (caller owns the query; this hook owns the mutations):
 *   const { data: content } = useQuery({
 *     queryKey: ['content', id, dekResolved],
 *     queryFn: async () => {
 *       if (dekRef.current) {
 *         const blob = await storageApi.downloadFile(id);
 *         const bytes = decryptFile(new Uint8Array(await blob.arrayBuffer()), dekRef.current);
 *         return new TextDecoder().decode(bytes);
 *       }
 *       return driveReadContent(contentUrl);
 *     },
 *     enabled: !!contentUrl && dekResolved,
 *   });
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@neutrino/auth';
import {
  initSodium,
  loadKeyPair,
  openSealedFileKey,
  activeKeyVersion,
  generateFileKey,
  encryptFileKey,
  isUnlocked,
  subscribeToLockState,
} from '@neutrino/e2e-crypto';
import {
  encryptionApi,
  driveAutosaveEncryptedContent,
  driveCreateEncryptedVersion,
} from '@/lib/api';

// ── Public API ────────────────────────────────────────────────────────────────

export interface UseEncryptedDocumentContentOptions {
  /** The drive file / document ID. */
  id: string;
  /** The filename used when writing content (e.g. 'doc.json', 'sheet.json'). */
  filename: string;
}

export interface UseEncryptedDocumentContentResult {
  /**
   * Ref that holds the resolved DEK, or `null` when the document is not
   * encrypted.  Safe to read at any time; stable identity across renders.
   */
  dekRef: React.MutableRefObject<Uint8Array | null>;
  /**
   * `true` once the DEK resolution attempt has completed (whether or not a key
   * was actually found).  Use this as the `enabled` guard on the content query
   * so the query never runs before the DEK is ready.
   */
  dekResolved: boolean;
  /**
   * `true` when the DEK was freshly generated (no prior key on the server),
   * meaning the server still holds plaintext content that needs encrypting.
   * `false` when the DEK was retrieved from an existing key ref — in that case
   * a decryption failure means the ciphertext is corrupt, not plaintext, and
   * the caller should NOT overwrite server content.
   */
  isNewEncryption: boolean;
  /**
   * The DEK once resolution has settled — `dekRef.current` without the race.
   * Reading `dekRef` directly reports "no key" for a save that lands while the
   * key is still being fetched; awaiting this reports it only when the session
   * is genuinely locked.
   */
  awaitDek: () => Promise<Uint8Array | null>;
  /** Write an autosave revision (no version-history entry). */
  autosave: (content: string) => void;
  /** Create a named version snapshot in version history. */
  createVersion: (content: string) => void;
  /** Whether the autosave mutation is currently in flight. */
  isAutosaving: boolean;
  /** Whether the createVersion mutation is currently in flight. */
  isCreatingVersion: boolean;
  /** The most recent autosave error, if any. */
  autosaveError: Error | null;
  /** The most recent createVersion error, if any. */
  createVersionError: Error | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEncryptedDocumentContent({
  id,
  filename,
}: UseEncryptedDocumentContentOptions): UseEncryptedDocumentContentResult {
  const { user: currentUser, isLoading: authLoading } = useAuth();
  const dekRef = useRef<Uint8Array | null>(null);
  const [dekResolved, setDekResolved] = useState(false);
  const [isNewEncryption, setIsNewEncryption] = useState(false);
  /** The in-flight resolution, so `awaitDek` can wait on it instead of racing. */
  const resolutionRef = useRef<Promise<void> | null>(null);
  /** Which `<file, user>` the key in `dekRef` belongs to. */
  const dekOwnerRef = useRef<string | null>(null);

  // The unlock gate is an overlay, not a hard gate (see `E2EEUnlockGate`), so an
  // editor routinely mounts while the vault is still locked — a page reload on
  // /docs/editor does it every time.  Without re-resolving on unlock the DEK
  // stays null for the life of the page and every autosave warns that changes
  // were not saved, even though the user unlocked seconds later.
  const [lockEpoch, setLockEpoch] = useState(0);
  useEffect(() => subscribeToLockState(() => setLockEpoch((n) => n + 1)), []);

  // ── Step 1: Resolve the DEK ───────────────────────────────────────────────
  useEffect(() => {
    // Wait for auth to finish loading so we don't mark as resolved early
    // with a null user — that would let the content query fire without a DEK,
    // causing encrypted bytes to be rendered as plaintext.
    if (authLoading) return;
    if (!id || !currentUser?.id) {
      setDekResolved(true);
      return;
    }

    const owner = `${currentUser.id}:${id}`;

    // Locked: no key to resolve, so `awaitDek` reports null and every caller
    // declines to save rather than writing plaintext (issue #95). The
    // subscription above brings us back here the moment that changes, and the
    // content is still in the editor, so nothing is lost by waiting.
    if (!isUnlocked(currentUser.id)) {
      dekRef.current = null;
      dekOwnerRef.current = null;
      resolutionRef.current = null;
      setDekResolved(true);
      return;
    }

    // Unlocked and already holding this file's key — a re-run from an unrelated
    // lock notification must not re-fetch it.  The owner check matters after a
    // user switch: the key in hand belongs to whoever was signed in when it was
    // resolved, and re-sealing DEKs to the wrong identity is unrecoverable.
    if (dekRef.current && dekOwnerRef.current === owner) return;
    dekRef.current = null;

    let cancelled = false;

    async function resolve() {
      try {
        await initSodium();
        const kp = loadKeyPair(currentUser!.id);
        if (kp) {
          const keyRef = await encryptionApi.getFileKey(id);
          if (!cancelled && keyRef) {
            dekRef.current = openSealedFileKey(
              currentUser!.id,
              keyRef.encryptedFileKey,
              keyRef.keyVersion,
            );
            dekOwnerRef.current = owner;
          } else if (!cancelled && !keyRef) {
            // New file: generate a DEK, encrypt it with the user's public key, and store it.
            const newDek = generateFileKey();
            const encryptedFileKey = encryptFileKey(newDek, kp.publicKey);
            await encryptionApi.setFileKey(id, {
              encryptedFileKey,
              keyVersion: activeKeyVersion(currentUser!.id) ?? undefined,
            });
            dekRef.current = newDek;
            dekOwnerRef.current = owner;
            setIsNewEncryption(true);
          }
        }
      } catch {
        // Non-fatal: the document may not be encrypted.  Continue without E2EE.
      } finally {
        if (!cancelled) setDekResolved(true);
      }
    }

    // Re-resolving after an unlock has to flip `dekResolved` back to false:
    // callers key their content query on it, and the copy on screen was read as
    // plaintext (or failed) while we had no key.
    setDekResolved(false);
    resolutionRef.current = resolve();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, authLoading, currentUser?.id, lockEpoch]);

  const awaitDek = useCallback(async () => {
    await resolutionRef.current;
    return dekRef.current;
  }, []);

  // ── Step 2: Autosave mutation ─────────────────────────────────────────────
  const autosaveMutation = useMutation({
    mutationFn: async (content: string) => {
      const dek = await awaitDek();
      if (!dek) throw new Error('no-dek');
      return driveAutosaveEncryptedContent(id, content, filename, dek);
    },
  });

  // ── Step 3: Create-version mutation ──────────────────────────────────────
  const createVersionMutation = useMutation({
    mutationFn: async (content: string) => {
      const dek = await awaitDek();
      if (!dek) throw new Error('no-dek');
      return driveCreateEncryptedVersion(id, content, filename, dek);
    },
  });

  return {
    dekRef,
    dekResolved,
    isNewEncryption,
    awaitDek,
    autosave: autosaveMutation.mutate,
    createVersion: createVersionMutation.mutate,
    isAutosaving: autosaveMutation.isPending,
    isCreatingVersion: createVersionMutation.isPending,
    autosaveError: autosaveMutation.error as Error | null,
    createVersionError: createVersionMutation.error as Error | null,
  };
}
