/**
 * Writing a Live Photo's link — its still's `metadata.device.liveVideoFileID` — for pairs the web
 * found by content identifier or filename stem (`agent_docs/live-photos.md`).
 *
 * The web pairs a still with its clip on its own without the link; the iOS apps don't, and look
 * for exactly this field to play a Live Photo and save it back to Apple Photos. So the web writes
 * it wherever it has made a pair: at the end of an import run, and lazily as the library is
 * browsed. Through `mergePhotoMetadata` (a JSON Merge Patch), never a whole-document write, so no
 * other key on the record is touched.
 */

import {
  missingMotionLinks,
  pairMotionPhotos,
  photosApi,
  type LibraryItem,
  type PhotoResponse,
} from '@neutrino/api-photos';
import { logFail, logStep } from '@/lib/takeout/log';

export type MergeMetadata = (photoId: string, patch: Record<string, unknown>) => Promise<unknown>;

const SCOPE = 'motion-links';

/** Writes each missing link, one request at a time. Returns how many were written. */
export async function writeMotionLinks(
  links: { photoId: string; liveVideoFileID: string }[],
  merge?: MergeMetadata,
  signal?: AbortSignal,
): Promise<number> {
  let written = 0;
  for (const link of links) {
    if (signal?.aborted) break;
    try {
      // Resolved here, inside the guard, rather than as a default parameter: a default is
      // evaluated before any `try`, and this must never throw.
      const write = merge ?? ((id: string, patch: Record<string, unknown>) => photosApi.mergePhotoMetadata(id, patch));
      await write(link.photoId, { device: { liveVideoFileID: link.liveVideoFileID } });
      written++;
    } catch (err) {
      // The pair still shows on the web; the next pass gets another try.
      logFail(SCOPE, `could not link ${link.photoId}`, err);
    }
  }
  return written;
}

/**
 * Pairs the photo records an import run registered and links the stills to their clips.
 * Never throws: the photos are imported either way, and the timeline backfill catches anything
 * missed here.
 */
export async function linkMotionPairs(
  registered: PhotoResponse[],
  merge?: MergeMetadata,
): Promise<number> {
  try {
    const stills = registered.filter((p) => p.mimeType?.startsWith('image/'));
    const clips = registered.filter((p) => p.mimeType?.startsWith('video/'));
    if (stills.length === 0 || clips.length === 0) return 0;
    const links = missingMotionLinks(pairMotionPhotos(stills, clips));
    const written = await writeMotionLinks(links, merge);
    if (written) logStep(SCOPE, `linked ${written} Live Photo pair(s)`);
    return written;
  } catch (err) {
    logFail(SCOPE, 'could not link the imported Live Photos', err);
    return 0;
  }
}

/** The links a library page could write now; see `useMotionLinkBackfill`. */
export function pendingMotionLinks(items: LibraryItem[], alreadyTried: Set<string>, max: number) {
  return missingMotionLinks(items).filter((l) => !alreadyTried.has(l.photoId)).slice(0, max);
}
