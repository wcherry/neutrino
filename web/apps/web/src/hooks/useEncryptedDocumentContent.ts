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

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useUser } from '@neutrino/auth';
import { initSodium, loadKeyPair, decryptFileKey, generateFileKey, encryptFileKey } from '@neutrino/e2e-crypto';
import {
  encryptionApi,
  driveAutosaveContent,
  driveAutosaveEncryptedContent,
  driveCreateVersion,
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
  const currentUser = useUser();
  const dekRef = useRef<Uint8Array | null>(null);
  const [dekResolved, setDekResolved] = useState(false);

  // ── Step 1: Resolve the DEK ───────────────────────────────────────────────
  useEffect(() => {
    // If there is no document ID or no logged-in user, mark as resolved
    // immediately so dependent queries are not blocked indefinitely.
    if (!id || !currentUser?.id) {
      setDekResolved(true);
      return;
    }

    let cancelled = false;

    async function resolve() {
      try {
        await initSodium();
        const kp = loadKeyPair(currentUser!.id);
        if (kp) {
          const keyRef = await encryptionApi.getFileKey(id);
          if (!cancelled && keyRef) {
            dekRef.current = decryptFileKey(
              keyRef.encryptedFileKey,
              kp.publicKey,
              kp.secretKey,
            );
          } else if (!cancelled && !keyRef) {
            // New file: generate a DEK, encrypt it with the user's public key, and store it.
            const newDek = generateFileKey();
            const encryptedFileKey = encryptFileKey(newDek, kp.publicKey);
            await encryptionApi.setFileKey(id, { encryptedFileKey });
            dekRef.current = newDek;
          }
        }
      } catch {
        // Non-fatal: the document may not be encrypted.  Continue without E2EE.
      } finally {
        if (!cancelled) setDekResolved(true);
      }
    }

    resolve();
    return () => { cancelled = true; };
    // currentUser.id is stable for the lifetime of a session; id changes only
    // when navigating to a different document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, currentUser?.id]);

  // ── Step 2: Autosave mutation ─────────────────────────────────────────────
  const autosaveMutation = useMutation({
    mutationFn: (content: string) =>
      dekRef.current
        ? driveAutosaveEncryptedContent(id, content, filename, dekRef.current)
        : driveAutosaveContent(id, content, filename),
  });

  // ── Step 3: Create-version mutation ──────────────────────────────────────
  const createVersionMutation = useMutation({
    mutationFn: (content: string) =>
      dekRef.current
        ? driveCreateEncryptedVersion(id, content, filename, dekRef.current)
        : driveCreateVersion(id, content, filename),
  });

  return {
    dekRef,
    dekResolved,
    autosave: autosaveMutation.mutate,
    createVersion: createVersionMutation.mutate,
    isAutosaving: autosaveMutation.isPending,
    isCreatingVersion: createVersionMutation.isPending,
    autosaveError: autosaveMutation.error as Error | null,
    createVersionError: createVersionMutation.error as Error | null,
  };
}
