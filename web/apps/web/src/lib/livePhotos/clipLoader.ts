/**
 * Downloading, decrypting and confirming a Live Photo's clip, once per session.
 *
 * Two things are cached, and they live for different lengths of time:
 *
 * - **The verdict** — is this clip really a Live Photo's motion? — is kept for
 *   the session, per clip key (`pairing.clipKey`: the clip's file id, or the
 *   still's for an embedded clip). It is small and does not change: a file's
 *   bytes are what they are. A tile that unmounts and comes back, or a preview
 *   reopened, does not download a video to ask again.
 * - **The decrypted bytes** are kept for the last few clips only
 *   (`BLOB_CACHE_SIZE`). A clip is 2–4 MB and a folder can hold hundreds; the
 *   point is that the clip confirmed in the background, or loaded by the
 *   preview, is still there when the tile is pressed a moment later.
 *
 * Confirmation is `isLikelyLivePhotoMov` on the decrypted movie's QuickTime
 * metadata, for a stem match nothing else vouches for. An ordinary video that
 * happens to share a picture's name fails it and is never played as one.
 */

import { isLikelyLivePhotoMov, readQuickTimeMetadata } from '@neutrino/api-photos';
import { loadPlainBlob } from '@/lib/plainFileBlob';
import { clipKey, type LiveClip } from './pairing';

/** How many decrypted clips are held in memory at once. */
export const BLOB_CACHE_SIZE = 6;

export interface ClipContext {
  userId: string;
  /** The session holds a key pair, so encrypted bytes can be opened. Nothing loads without one. */
  unlocked: boolean;
  /** The still's decrypted bytes, when the caller already has them (the preview does). */
  stillBlob?: Blob | null;
}

export interface ClipLoaderDeps {
  loadPlainBlob: (fileId: string, userId: string, unlocked: boolean) => Promise<Blob>;
  readQuickTimeMetadata: (blob: Blob) => Promise<Record<string, string | number> | null>;
}

const defaultDeps: ClipLoaderDeps = { loadPlainBlob, readQuickTimeMetadata };

type Verdict = boolean;

const verdicts = new Map<string, Verdict>();
const inFlight = new Map<string, Promise<Blob | null>>();
/** Insertion-ordered, so the first key is the least recently used. */
const blobs = new Map<string, Blob>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function remember(key: string, blob: Blob): void {
  blobs.delete(key);
  blobs.set(key, blob);
  while (blobs.size > BLOB_CACHE_SIZE) {
    const oldest = blobs.keys().next().value as string;
    blobs.delete(oldest);
  }
}

/** What is known about this clip so far: true, false, or undefined for "not checked yet". */
export function clipVerdict(key: string): Verdict | undefined {
  return verdicts.get(key);
}

/** Called whenever a verdict is recorded, for `useSyncExternalStore`. */
export function subscribeToClipVerdicts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The decrypted clip if it is already in memory, without fetching anything. */
export function cachedClip(key: string): Blob | null {
  const blob = blobs.get(key);
  if (!blob) return null;
  remember(key, blob);
  return blob;
}

async function fetchClip(stillId: string, clip: LiveClip, ctx: ClipContext, deps: ClipLoaderDeps): Promise<Blob | null> {
  if (clip.kind === 'embedded') {
    const still = ctx.stillBlob ?? (await deps.loadPlainBlob(stillId, ctx.userId, ctx.unlocked));
    return still.slice(clip.offset, clip.offset + clip.length, 'video/mp4');
  }

  const plain = await deps.loadPlainBlob(clip.fileId, ctx.userId, ctx.unlocked);
  const typed = new Blob([plain], { type: clip.mimeType });
  if (clip.confirmed) return typed;

  // A same-named video nothing vouches for: its own metadata decides.
  const metadata = await deps.readQuickTimeMetadata(typed).catch(() => null);
  return metadata && isLikelyLivePhotoMov(metadata) ? typed : null;
}

/**
 * The playable clip, or null when it turned out not to be a Live Photo's.
 *
 * Concurrent callers share one download. A failure (network, decryption) is
 * thrown and *not* recorded as a verdict, so the next press tries again; only
 * a clip that loaded and was not a Live Photo is remembered as `false`.
 */
export function loadLiveClip(
  stillId: string,
  clip: LiveClip,
  ctx: ClipContext,
  deps: ClipLoaderDeps = defaultDeps,
): Promise<Blob | null> {
  const key = clipKey(stillId, clip);
  if (verdicts.get(key) === false) return Promise.resolve(null);
  const cached = cachedClip(key);
  if (cached) return Promise.resolve(cached);
  // Locked, the download is ciphertext: it would neither play nor parse, and a
  // failed parse must not be remembered as "not a Live Photo".
  if (!ctx.unlocked) return Promise.reject(new Error('The session is locked; the clip cannot be decrypted.'));
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = fetchClip(stillId, clip, ctx, deps)
    .then((blob) => {
      verdicts.set(key, blob !== null);
      if (blob) remember(key, blob);
      notify();
      return blob;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Forget everything — for tests, and for sign-out. */
export function resetLiveClipCache(): void {
  verdicts.clear();
  inFlight.clear();
  blobs.clear();
  notify();
}
