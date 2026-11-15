/**
 * The preview's answer to "does this picture move?" — the grid's answer plus
 * the two lookups the grid is too cheap to make.
 *
 * The grid pairs within the listing it has loaded and the records it fetched in
 * one batch. The preview is one file the user chose to look at, so it may also
 * (a) page through the still's folder for a same-stem video the listing has not
 * reached yet, and (b) read the still's own decrypted bytes for a Google Motion
 * Photo's embedded MP4 — both of which the grid would have to do for every
 * picture on screen.
 */

import type { FolderContentsResponse, FileListQuery } from '@neutrino/api-drive';
import type { MotionPhotoInfo, PhotoResponse } from '@neutrino/api-photos';
import { embeddedClipFrom, findLiveClip, isStillCandidate, stemSibling, type LiveClip, type PairableFile } from './pairing';

/** How far through a folder the preview looks for a sibling: 10 pages of 200. */
export const FOLDER_LOOKUP_PAGES = 10;
const FOLDER_PAGE_SIZE = 200;

export interface ResolvePreviewDeps {
  listPhotosByFiles: (fileIds: string[]) => Promise<PhotoResponse[]>;
  getFolderContents: (folderId: string, query: FileListQuery) => Promise<FolderContentsResponse>;
  readMotionPhotoInfo: (blob: Blob, file: { fileName?: string; mimeType?: string }) => Promise<MotionPhotoInfo | null>;
}

export interface ResolvePreviewInput<T extends PairableFile> {
  still: T;
  /** The still's decrypted bytes — before any HEIC transcode. */
  stillBlob: Blob;
  /** The listing the preview was opened from, if any. */
  siblings?: readonly T[];
  /** The id `getFolderContents` lists the drive root under: the user's own. */
  rootFolderId: string | null;
}

async function recordsFor(ids: string[], deps: ResolvePreviewDeps): Promise<Map<string, PhotoResponse>> {
  // A picture nobody registered with Photos is the common case in Drive, and a
  // failed lookup must not cost the preview its stem and embedded checks.
  const records = await deps.listPhotosByFiles(ids).catch(() => [] as PhotoResponse[]);
  return new Map(records.map((r) => [r.fileId, r]));
}

/** Page through the still's folder for a same-stem video. */
async function lookUpSibling(
  still: PairableFile,
  rootFolderId: string | null,
  deps: ResolvePreviewDeps,
): Promise<PairableFile | null> {
  const folderId = still.folderId ?? rootFolderId;
  if (!folderId) return null;
  for (let page = 0; page < FOLDER_LOOKUP_PAGES; page++) {
    const contents = await deps
      .getFolderContents(folderId, { type: 'video', limit: FOLDER_PAGE_SIZE, offset: page * FOLDER_PAGE_SIZE })
      .catch(() => null);
    if (!contents) return null;
    // The listing's files carry the folder they were asked for, which for the
    // root is null — the same as the still's.
    const match = stemSibling(still, contents.files);
    if (match) return match;
    if (contents.files.length < FOLDER_PAGE_SIZE) return null;
  }
  return null;
}

export async function resolvePreviewClip<T extends PairableFile>(
  { still, stillBlob, siblings = [], rootFolderId }: ResolvePreviewInput<T>,
  deps: ResolvePreviewDeps,
): Promise<LiveClip | null> {
  if (!isStillCandidate(still)) return null;

  // 1–2 from what is loaded, asking for the still's record and a loaded
  // sibling's in one request.
  const loadedSibling = stemSibling(still, siblings);
  let records = await recordsFor(loadedSibling ? [still.id, loadedSibling.id] : [still.id], deps);
  const stillRecord = records.get(still.id) ?? null;
  const fromLoaded = findLiveClip(still, { siblings, stillRecord, recordsByFile: records });
  if (fromLoaded && fromLoaded.kind === 'file') return fromLoaded;

  // 2, for a sibling on a page the listing has not reached (or no listing at
  // all — a deep-linked preview).
  if (!loadedSibling) {
    const found = await lookUpSibling(still, rootFolderId, deps);
    if (found) {
      records = new Map([...records, ...(await recordsFor([found.id], deps))]);
      const clip = findLiveClip(still, { siblings: [found], stillRecord, recordsByFile: records });
      if (clip) return clip;
    }
  }

  // 3. Google: the record knows where the MP4 is; failing that, the bytes do.
  if (fromLoaded) return fromLoaded;
  const info = await deps
    .readMotionPhotoInfo(stillBlob, { fileName: still.name, mimeType: still.mimeType })
    .catch(() => null);
  return embeddedClipFrom(info);
}
