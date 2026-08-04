'use client';

/**
 * Editor-side half of the stale-save rejection in `agent_docs/search.md`.
 *
 * Every content write bumps the file's `contentVersion`. An editor holds the
 * version it loaded, sends it with each save, and the server rejects the write
 * if anything landed in between. Without this, two tabs (or two devices, or one
 * device coming back online) each hold a full copy of the document and the last
 * one to save silently erases the other's work.
 *
 * The guard is deliberately *not* automatic-merge: the editors here own opaque
 * document formats (Tiptap JSON, sheet cell maps, slide trees) with no
 * meaningful three-way merge, so the honest options are to reload and lose
 * local edits, or to overwrite and lose remote ones. This hook surfaces exactly
 * that choice and leaves it to the user.
 */

import { useCallback, useRef, useState } from 'react';
import { isContentVersionConflict, type ContentVersionCheck } from '@neutrino/api-core';

export interface ContentVersionGuard {
  /**
   * The guard for the next save.
   *
   * Normally the version this editor last saw. After a rejected save it is
   * `{ force: true }` and the conflict is cleared — the user has been told the
   * document changed and that saving again keeps their copy, so the second save
   * is their answer. Deliberately one-shot: a later save re-arms the guard
   * against the revision the overwrite produced.
   */
  check: () => ContentVersionCheck | undefined;
  /** Record the version a load or a successful save reported. */
  observe: (version: number | undefined) => void;
  /**
   * Classify a save failure. Returns true when it was a version conflict, which
   * the caller should surface rather than treat as a transient error.
   */
  handleError: (error: unknown) => boolean;
  /** True while a conflict is unresolved. */
  hasConflict: boolean;
  /** Drop the conflict without saving — for a reload path. */
  dismiss: () => void;
}

/**
 * Track a file's content revision across saves.
 *
 * `initialVersion` comes from whatever loaded the document; passing `undefined`
 * leaves saves unguarded until the first version is observed, which is the safe
 * default — an editor that never learns a version behaves exactly as it did
 * before this existed.
 */
export function useContentVersionGuard(initialVersion?: number): ContentVersionGuard {
  const versionRef = useRef<number | undefined>(initialVersion);
  // Read inside `check`, which must not be re-created per render or every
  // mutation depending on it would be rebuilt on each keystroke.
  const conflictRef = useRef(false);
  const [hasConflict, setHasConflict] = useState(false);

  const check = useCallback((): ContentVersionCheck | undefined => {
    if (conflictRef.current) {
      conflictRef.current = false;
      setHasConflict(false);
      return { force: true };
    }
    if (versionRef.current === undefined) return undefined;
    return { expectedContentVersion: versionRef.current };
  }, []);

  const observe = useCallback((version: number | undefined) => {
    if (version === undefined) return;
    versionRef.current = version;
  }, []);

  const handleError = useCallback((error: unknown): boolean => {
    if (!isContentVersionConflict(error)) return false;
    conflictRef.current = true;
    setHasConflict(true);
    return true;
  }, []);

  /** Drop the conflict without saving — for a reload path. */
  const dismiss = useCallback(() => {
    conflictRef.current = false;
    setHasConflict(false);
  }, []);

  return { check, observe, handleError, hasConflict, dismiss };
}
