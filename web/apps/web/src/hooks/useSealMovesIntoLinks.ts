'use client';

import { useEffect } from 'react';
import { useUser } from '@neutrino/auth';
import { sealLinksCoveringFolder, setMovedIntoFolderHook } from '@neutrino/api-drive';

/**
 * Makes a file moved into a link-shared folder readable through the link (#321).
 *
 * A move keeps a file's keys as they were, so a file moved into a folder that has a link was
 * listed to people with the link but would not open for them ("not ready to open through this link
 * yet"). Every move in the app goes through `filesystemApi`, which reports the destination folder to
 * this hook; it seals whatever the covering links cannot open yet, with this user's keyring.
 *
 * Mounted once, in the shell, for as long as someone is signed in. It never holds a move up: the
 * sealing runs after the move has succeeded, and anything it misses is caught up the next time the
 * owner opens the folder's Share dialog.
 */
export function useSealMovesIntoLinks(): void {
  const userId = useUser()?.id;

  useEffect(() => {
    if (!userId) return;
    setMovedIntoFolderHook((folderId) => {
      void sealLinksCoveringFolder(userId, folderId).catch((e) =>
        console.warn('[useSealMovesIntoLinks] sealing after a move failed (non-fatal):', e),
      );
    });
    return () => setMovedIntoFolderHook(null);
  }, [userId]);
}
