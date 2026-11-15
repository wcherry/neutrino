'use client';

/**
 * Which stills in a loaded Drive listing are Live Photos, for the grid's badges
 * and holds (issue #316).
 *
 * The listing says nothing about photos, so this asks Photos for the records
 * behind its pictures and videos in one batch (`POST /photos/by-files`) and
 * pairs them with `pairListing`. That settles most pairs without a byte
 * downloaded: a still that links its clip, a Google still whose record knows
 * where its MP4 is, and a same-named clip whose own record says it is a Live
 * Photo's motion.
 *
 * What is left is a same-named video nothing vouches for — a pair uploaded
 * through Drive rather than imported into Photos. Its badge depends on the
 * clip's own metadata, so those clips are fetched and checked in the
 * background, **one at a time** and only up to `MAX_BACKGROUND_CLIP_BYTES`: a
 * Live Photo's clip is 2–4 MB, and a video much larger than that is not one
 * and is not worth downloading to find out. The verdict is kept for the
 * session, and the decrypted clip stays in the loader's small cache so the
 * first hold on that tile is instant.
 */

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { photosApi } from '@neutrino/api-photos';
import { useUser } from '@neutrino/auth';
import type { FileItem } from '@neutrino/api-drive';
import { useSessionKeyPair } from '@/hooks/useSessionKeyPair';
import { clipKey, isClipCandidate, isStillCandidate, pairListing, type LiveClip } from '@/lib/livePhotos/pairing';

/** The largest unvouched-for clip confirmed in the background. */
export const MAX_BACKGROUND_CLIP_BYTES = 12 * 1024 * 1024;

export function useDriveLivePhotos(files: readonly FileItem[]): Map<string, LiveClip> {
  const user = useUser();
  const keyPair = useSessionKeyPair(user?.id);

  const hasStills = useMemo(() => files.some(isStillCandidate), [files]);
  const ids = useMemo(
    () => (hasStills ? files.filter((f) => isStillCandidate(f) || isClipCandidate(f)).map((f) => f.id) : []),
    [files, hasStills],
  );

  const { data: records, isFetched } = useQuery({
    queryKey: ['drive-live-photo-records', ids.join(',')],
    queryFn: () => photosApi.listPhotosByFiles(ids),
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    // Drive without a Photos record is ordinary; a failed lookup only costs
    // the badges the records would have confirmed.
    retry: false,
  });

  const clips = useMemo(
    () => (hasStills ? pairListing(files, records ?? []) : new Map<string, LiveClip>()),
    [files, records, hasStills],
  );

  // Confirm the name-only pairs, once the records have had their say.
  useEffect(() => {
    if (!user?.id || !keyPair || (ids.length > 0 && !isFetched)) return;
    const pending = [...clips].filter(
      ([, clip]) =>
        clip.kind === 'file' &&
        !clip.confirmed &&
        clip.sizeBytes !== null &&
        clip.sizeBytes <= MAX_BACKGROUND_CLIP_BYTES,
    );
    if (pending.length === 0) return;

    let cancelled = false;
    void (async () => {
      // On demand: most folders have no unvouched-for pair, and the loader
      // brings the QuickTime parser with it.
      const { clipVerdict, loadLiveClip } = await import('@/lib/livePhotos/clipLoader');
      for (const [stillId, clip] of pending) {
        if (clipVerdict(clipKey(stillId, clip)) !== undefined) continue;
        if (cancelled) return;
        await loadLiveClip(stillId, clip, { userId: user.id, unlocked: true }).catch(() => null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clips, user?.id, keyPair, ids.length, isFetched]);

  return clips;
}
