/**
 * Which Drive file, or which bytes, hold a Live Photo still's clip (issue #316).
 *
 * Drive's folder listing carries no photo metadata, so Drive works the pairing
 * out itself, in the order the issue sets:
 *
 * 1. **The photo record's link.** A still registered with Photos may name its
 *    clip in `metadata.device.liveVideoFileID` — the platform's Live Photo
 *    convention (`agent_docs/live-photos.md`). It is the only way to find a clip
 *    stored the Photos iOS way, under another name in another folder, and it is
 *    an explicit statement that the file is this still's motion, so it needs no
 *    further check.
 * 2. **A same-folder sibling with the same stem.** `IMG_1234.HEIC` beside
 *    `IMG_1234.MOV`, case-insensitive — what Drive iOS photo sync, Apple's own
 *    export and Takeout all produce. A stem is a guess: any video can share a
 *    picture's name. So a stem match is only *confirmed* when the clip's own
 *    photo record says it is a motion photo (classified from its bytes at
 *    upload); otherwise the bytes are checked after decryption
 *    (`clipLoader.ts`) and an ordinary video never gets a badge.
 * 3. **Google's embedded clip.** A Motion Photo carries its MP4 inside the
 *    JPEG. The record knows where when it was registered; otherwise the preview
 *    finds it with `readMotionPhotoInfo` on the still it already decrypted.
 *
 * Everything here is pure, so the precedence is unit-tested without a network.
 */

import {
  motionPhotoOf,
  motionPhotoStem,
  type MotionPhotoInfo,
  type MotionPhotoSubtype,
  type PhotoResponse,
} from '@neutrino/api-photos';

/** The parts of a Drive file pairing reads. `FileItem` satisfies it. */
export interface PairableFile {
  id: string;
  name: string;
  mimeType: string;
  folderId: string | null;
  sizeBytes: number;
  /** Bumped on every content write; part of the cache key, so a rewritten clip is fetched again. */
  contentVersion?: number;
}

/** A clip held in a Drive file of its own — Apple's split. */
export interface FileClip {
  kind: 'file';
  /** The Drive file holding the clip. */
  fileId: string;
  /** What to type the decrypted bytes as; the server may only know octet-stream. */
  mimeType: string;
  sizeBytes: number | null;
  /** The clip file's content version when known — a key photo change (#317) rewrites the clip. */
  contentVersion?: number;
  /** How it was found: the record's link, or a sibling's name. */
  via: 'link' | 'stem';
  /**
   * True when something other than the clip's bytes already says it is a Live
   * Photo's motion — the still's link, or the clip's own record. False means
   * the bytes must be checked before it is shown as one.
   */
  confirmed: boolean;
  subtype: MotionPhotoSubtype;
}

/** A clip inside the still's own bytes — Google's packing. */
export interface EmbeddedClip {
  kind: 'embedded';
  offset: number;
  length: number;
  confirmed: true;
  subtype: 'motion_photo_google';
}

export type LiveClip = FileClip | EmbeddedClip;

const STILL_EXTENSIONS = /\.(heic|heif|jpe?g|png)$/i;
const CLIP_EXTENSIONS = /\.(mov|mp4|m4v|qt)$/i;

/** Could this file be the still half? Images, plus a HEIC the server typed octet-stream. */
export function isStillCandidate(file: Pick<PairableFile, 'name' | 'mimeType'>): boolean {
  return file.mimeType.startsWith('image/') || STILL_EXTENSIONS.test(file.name);
}

/** Could this file be a clip? Any video, plus a `.mov` the server typed octet-stream. */
export function isClipCandidate(file: Pick<PairableFile, 'name' | 'mimeType'>): boolean {
  return file.mimeType.startsWith('video/') || CLIP_EXTENSIONS.test(file.name);
}

/** The mime type a clip's decrypted bytes should be handed to `<video>` as. */
export function clipMimeType(file: Pick<PairableFile, 'name' | 'mimeType'>): string {
  if (file.mimeType.startsWith('video/')) return file.mimeType;
  return /\.(mp4|m4v)$/i.test(file.name) ? 'video/mp4' : 'video/quicktime';
}

/** The clip a Google Motion Photo carries inside itself, if `info` located one. */
export function embeddedClipFrom(info: MotionPhotoInfo | null | undefined): EmbeddedClip | null {
  const embedded = info?.embedded;
  if (!embedded || embedded.length <= 0) return null;
  return {
    kind: 'embedded',
    offset: embedded.offset,
    length: embedded.length,
    confirmed: true,
    subtype: 'motion_photo_google',
  };
}

/** The same-stem video beside `still`, from files known to share its folder. */
export function stemSibling<T extends PairableFile>(still: PairableFile, siblings: readonly T[]): T | null {
  const stem = motionPhotoStem(still.name);
  if (!stem) return null;
  for (const file of siblings) {
    if (file.id === still.id || file.folderId !== still.folderId) continue;
    if (!isClipCandidate(file)) continue;
    if (motionPhotoStem(file.name) === stem) return file;
  }
  return null;
}

export interface FindLiveClipInput<T extends PairableFile> {
  /** Files in the still's folder that are already loaded (a listing page). */
  siblings?: readonly T[];
  /** The still's photo record, when it has one. */
  stillRecord?: PhotoResponse | null;
  /** Photo records by Drive file id, for confirming a stem match from the clip's side. */
  recordsByFile?: ReadonlyMap<string, PhotoResponse>;
}

/**
 * The clip for `still`, by the precedence above, or null when nothing pairs.
 *
 * A null answer from here is not final for the preview: it can still look the
 * folder up for a sibling that is not loaded, and read the still's own bytes for
 * an embedded clip. The grid stops here — it does not download pictures to find
 * out whether they move.
 */
export function findLiveClip<T extends PairableFile>(
  still: T,
  { siblings = [], stillRecord = null, recordsByFile }: FindLiveClipInput<T>,
): LiveClip | null {
  if (!isStillCandidate(still)) return null;

  const linked = stillRecord?.metadata?.device?.liveVideoFileID;
  if (linked && linked !== still.id) {
    const file = siblings.find((f) => f.id === linked) ?? null;
    const clipRecord = recordsByFile?.get(linked);
    return {
      kind: 'file',
      fileId: linked,
      mimeType: file
        ? clipMimeType(file)
        : clipRecord
          ? clipMimeType({ name: clipRecord.fileName, mimeType: clipRecord.mimeType })
          : 'video/quicktime',
      sizeBytes: file?.sizeBytes ?? clipRecord?.sizeBytes ?? null,
      ...(file?.contentVersion !== undefined ? { contentVersion: file.contentVersion } : {}),
      via: 'link',
      confirmed: true,
      subtype: (clipRecord && motionPhotoOf(clipRecord)?.subtype) || 'live_photo_apple',
    };
  }

  const sibling = stemSibling(still, siblings);
  if (sibling) {
    const clipRecord = recordsByFile?.get(sibling.id);
    const clipInfo = clipRecord ? motionPhotoOf(clipRecord) : null;
    return {
      kind: 'file',
      fileId: sibling.id,
      mimeType: clipMimeType(sibling),
      sizeBytes: sibling.sizeBytes,
      ...(sibling.contentVersion !== undefined ? { contentVersion: sibling.contentVersion } : {}),
      via: 'stem',
      confirmed: clipInfo !== null,
      subtype: clipInfo?.subtype ?? 'live_photo_apple',
    };
  }

  return embeddedClipFrom(stillRecord ? motionPhotoOf(stillRecord) : null);
}

/**
 * Every still in a loaded listing that has a clip, keyed by the still's file id.
 *
 * A clip a still names by link is not offered to a second still by stem — the
 * link is the stronger claim, and one clip is one Live Photo's motion.
 */
export function pairListing<T extends PairableFile>(
  files: readonly T[],
  records: readonly PhotoResponse[] = [],
): Map<string, LiveClip> {
  const recordsByFile = new Map(records.map((r) => [r.fileId, r]));
  const linkedClips = new Set<string>();
  for (const record of records) {
    const linked = record.metadata?.device?.liveVideoFileID;
    if (linked) linkedClips.add(linked);
  }

  const result = new Map<string, LiveClip>();
  for (const file of files) {
    if (!isStillCandidate(file)) continue;
    const stillRecord = recordsByFile.get(file.id) ?? null;
    const ownLink = stillRecord?.metadata?.device?.liveVideoFileID;
    const siblings = ownLink ? files : files.filter((f) => !linkedClips.has(f.id));
    const clip = findLiveClip(file, { siblings, stillRecord, recordsByFile });
    if (clip) result.set(file.id, clip);
  }
  return result;
}

/**
 * The session-cache key a clip's verdict and bytes are kept under: the file and
 * its content version, so a clip rewritten by a key-photo change (#317) is a
 * different entry rather than the stale one.
 */
export function clipKey(stillId: string, clip: LiveClip): string {
  if (clip.kind === 'embedded') return `embedded:${stillId}`;
  return clip.contentVersion !== undefined ? `${clip.fileId}@${clip.contentVersion}` : clip.fileId;
}
