/**
 * Syncing the local search index between a user's devices.
 *
 * `searchIndexer.ts` builds the index by fetching and decrypting every document
 * the user owns — minutes of work on a large account, repeated in full on every
 * new device and every browser profile. This module makes that a one-off: the
 * device that did the work uploads its whole index, encrypted, and the others
 * restore from it.
 *
 * This is the "periodically the database should be saved encrypted to the
 * server for sync to other clients" half of `agent_docs/search.md`. The blob is
 * stored server-side as a hidden file under the private store, so it never
 * appears in Drive.
 *
 * ## Encryption
 *
 * The snapshot holds decrypted titles and terms, so it is treated exactly like
 * a document body: a fresh data key per upload, the bytes sealed with it, and
 * the key sealed to the user's own public key. The server stores both and can
 * open neither.
 *
 * ## Conflicts
 *
 * Uploads carry the version the client last saw. If another device has uploaded
 * since, the server rejects the write rather than letting a device with a
 * partial index overwrite a fuller one — the same optimistic-concurrency rule
 * `search.md` asks for on file saves. The loser pulls, merges by re-uploading
 * the union, and the merge is safe because both indexes describe the same
 * documents.
 */

import {
  deserializeSnapshot,
  exportSnapshot,
  importSnapshot,
  serializeSnapshot,
  IndexEngine,
  type IndexSnapshot,
} from '@neutrino/search';
import {
  isSnapshotConflict,
  searchSnapshotApi,
  type SnapshotMeta,
} from '@neutrino/api-search';
import {
  decryptFile,
  decryptFileKey,
  encryptFile,
  encryptFileKey,
  generateFileKey,
  initSodium,
  loadKeyPair,
} from '@neutrino/e2e-crypto';

const DEVICE_ID_KEY = 'neutrino:search:deviceId';
const LAST_PUSHED_KEY_PREFIX = 'neutrino:search:snapshotVersion:';
const FINGERPRINT_KEY_PREFIX = 'neutrino:search:snapshotFingerprint:';

/**
 * Stable per-browser id, so a device can recognise its own upload in the
 * metadata and skip downloading back what it just sent.
 */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, fresh);
    return fresh;
  } catch {
    // Private mode: a per-session id still beats colliding with other devices.
    return crypto.randomUUID();
  }
}

/** The snapshot version this device last successfully pushed or pulled. */
function lastSyncedVersion(userId: string): number | undefined {
  try {
    const raw = localStorage.getItem(`${LAST_PUSHED_KEY_PREFIX}${userId}`);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rememberVersion(userId: string, version: number): void {
  try {
    localStorage.setItem(`${LAST_PUSHED_KEY_PREFIX}${userId}`, String(version));
  } catch {
    // Storage failures cost an extra round-trip next time, nothing more.
  }
}

/** Test seam — forgets what this device thinks it last synced. */
export function forgetSyncedVersion(userId: string): void {
  try {
    localStorage.removeItem(`${LAST_PUSHED_KEY_PREFIX}${userId}`);
    localStorage.removeItem(`${FINGERPRINT_KEY_PREFIX}${userId}`);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

/**
 * Cheap identity for a snapshot's contents.
 *
 * Uploading is the expensive half of a sync — serialise, encrypt, send several
 * megabytes — and most syncs run against an index nothing has touched. Counts
 * plus the newest revision are enough to notice any indexing that happened,
 * because every write path bumps a document's `updatedAt` or changes how many
 * entries there are.
 */
export function snapshotFingerprint(snapshot: IndexSnapshot): string {
  let newest = 0;
  for (const doc of snapshot.docs) {
    if (doc.updatedAt > newest) newest = doc.updatedAt;
  }
  return `${snapshot.docs.length}:${snapshot.tokens.length}:${newest}`;
}

function storedFingerprint(userId: string): string | null {
  try {
    return localStorage.getItem(`${FINGERPRINT_KEY_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function rememberFingerprint(userId: string, fingerprint: string): void {
  try {
    localStorage.setItem(`${FINGERPRINT_KEY_PREFIX}${userId}`, fingerprint);
  } catch {
    // Costs a redundant upload next time; nothing breaks.
  }
}

async function encryptSnapshot(
  snapshot: IndexSnapshot,
  publicKey: Uint8Array,
): Promise<{ ciphertext: Uint8Array; wrappedKey: string }> {
  await initSodium();
  const dek = generateFileKey();
  return {
    ciphertext: encryptFile(serializeSnapshot(snapshot), dek),
    // Sealed to the user's own public key: every device of theirs holds the
    // matching secret key, and nothing else does.
    wrappedKey: encryptFileKey(dek, publicKey),
  };
}

async function decryptSnapshot(
  ciphertext: Uint8Array,
  wrappedKey: string,
  publicKey: Uint8Array,
  secretKey: Uint8Array,
): Promise<IndexSnapshot> {
  await initSodium();
  const dek = decryptFileKey(wrappedKey, publicKey, secretKey);
  return deserializeSnapshot(decryptFile(ciphertext, dek));
}

export interface PushResult {
  status: 'uploaded' | 'conflict' | 'skipped';
  /** The stored version after a successful upload. */
  version?: number;
  /** Documents in the uploaded snapshot. */
  documents?: number;
}

export interface PullResult {
  status: 'imported' | 'up-to-date' | 'none';
  version?: number;
  /** Documents imported into the local index. */
  documents?: number;
}

/**
 * Upload the local index as the user's snapshot.
 *
 * On a version conflict this does not retry: the caller has just been told
 * another device is ahead, and the right move is to pull that snapshot first.
 * Retrying blindly is how the fuller index gets lost.
 */
export async function pushSnapshot(userId: string): Promise<PushResult> {
  const keys = loadKeyPair(userId);
  // No keys, no plaintext index worth uploading — the same gate the indexer
  // and the query path use.
  if (!keys) return { status: 'skipped' };

  const snapshot = await exportSnapshot();
  if (snapshot.docs.length === 0) {
    // Never replace a real snapshot with an empty one. A device whose local
    // index has not been built yet has nothing worth sharing.
    return { status: 'skipped' };
  }

  const fingerprint = snapshotFingerprint(snapshot);
  if (fingerprint === storedFingerprint(userId)) {
    // Identical to what is already stored — including the case where we just
    // imported it, which would otherwise make every pull echo straight back.
    return { status: 'skipped' };
  }

  const { ciphertext, wrappedKey } = await encryptSnapshot(snapshot, keys.publicKey);

  try {
    const meta = await searchSnapshotApi.upload(ciphertext, {
      expectedVersion: lastSyncedVersion(userId),
      wrappedKey,
      deviceId: deviceId(),
    });
    rememberVersion(userId, meta.version);
    rememberFingerprint(userId, fingerprint);
    console.debug(
      `[search:sync] uploaded snapshot v${meta.version} — ` +
        `${snapshot.docs.length} docs, ${ciphertext.length} bytes`,
    );
    return { status: 'uploaded', version: meta.version, documents: snapshot.docs.length };
  } catch (error) {
    if (isSnapshotConflict(error)) {
      console.debug('[search:sync] upload rejected — another device is ahead');
      return { status: 'conflict' };
    }
    throw error;
  }
}

/**
 * Upload the local index, overriding the version check.
 *
 * The deliberate "my index is the good one" path, behind Settings → Rebuild
 * index. A normal push defers to whatever is stored, which is wrong here: the
 * user rebuilt precisely because the stored snapshot is not to be trusted.
 */
export async function forceUploadSnapshot(userId: string): Promise<PushResult> {
  const keys = loadKeyPair(userId);
  if (!keys) return { status: 'skipped' };

  const snapshot = await exportSnapshot();
  if (snapshot.docs.length === 0) return { status: 'skipped' };

  const { ciphertext, wrappedKey } = await encryptSnapshot(snapshot, keys.publicKey);
  const meta = await searchSnapshotApi.upload(ciphertext, {
    force: true,
    wrappedKey,
    deviceId: deviceId(),
  });
  rememberVersion(userId, meta.version);
  rememberFingerprint(userId, snapshotFingerprint(snapshot));
  console.debug(`[search:sync] force-uploaded snapshot v${meta.version}`);
  return { status: 'uploaded', version: meta.version, documents: snapshot.docs.length };
}

/**
 * Restore the stored snapshot into the local index, if it is newer than what
 * this device last synced.
 *
 * Skips its own uploads (`deviceId` match) and versions it has already seen, so
 * running this on every app start and tab focus costs one small metadata
 * request in the common case.
 */
export async function pullSnapshot(userId: string): Promise<PullResult> {
  const keys = loadKeyPair(userId);
  if (!keys) return { status: 'none' };

  const meta = await searchSnapshotApi.getMeta();
  if (!meta) return { status: 'none' };

  const localDocumentCount = await new IndexEngine().countDocuments();
  if (!shouldImport(userId, meta, localDocumentCount)) {
    // Safe to record only because we just confirmed an index is actually here;
    // on the old code path this line marked versions as seen that had never
    // been imported, which is what made a lost index stay lost.
    rememberVersion(userId, meta.version);
    return { status: 'up-to-date', version: meta.version };
  }

  const ciphertext = await searchSnapshotApi.download();
  // Deleted between the metadata read and the download.
  if (!ciphertext) return { status: 'none' };

  const snapshot = await decryptSnapshot(
    ciphertext,
    meta.wrappedKey,
    keys.publicKey,
    keys.secretKey,
  );
  const documents = await importSnapshot(snapshot);
  rememberVersion(userId, meta.version);
  // The local index now *is* this snapshot, so record its fingerprint: without
  // this the push that follows would re-upload what we just downloaded.
  rememberFingerprint(userId, snapshotFingerprint(snapshot));
  console.debug(
    `[search:sync] imported snapshot v${meta.version} — ${documents} docs`,
  );
  return { status: 'imported', version: meta.version, documents };
}

/**
 * Whether a stored snapshot is worth downloading and importing.
 *
 * Exported for the sync hook's tests: getting this wrong either wipes a good
 * local index with an older one, or leaves a device permanently stale.
 *
 * `localDocumentCount` is not an optimisation — it is the only input here that
 * describes the index itself. Everything else is localStorage bookkeeping, and
 * localStorage outlives IndexedDB in every case that matters: the object stores
 * are dropped outright on a database upgrade (see `db.ts`), `rebuildSearchIndex`
 * clears them before repopulating and can fail in between, and browsers evict
 * IndexedDB under quota pressure. Deciding from the bookkeeping alone leaves a
 * device with an empty index insisting it is up to date.
 */
export function shouldImport(
  userId: string,
  meta: SnapshotMeta,
  localDocumentCount: number,
): boolean {
  // Nothing here to protect: whatever the bookkeeping claims, an empty index
  // always loses to a stored snapshot.
  if (localDocumentCount === 0) return true;

  // Our own upload, and we still hold an index — so it is already what the
  // snapshot was made from. The count check above is what makes this safe:
  // a device that uploaded and then lost its index would otherwise never pull
  // its own snapshot back.
  if (meta.deviceId === deviceId()) return false;

  const seen = lastSyncedVersion(userId);
  return seen === undefined || meta.version > seen;
}

/**
 * Pull anything newer, then push if this device has more than the server does.
 *
 * The pull-then-push order is what makes the conflict rule safe: by the time
 * the push runs, the local index already contains whatever the remote snapshot
 * had, so uploading it cannot lose another device's work.
 */
export async function syncSnapshot(userId: string): Promise<{
  pull: PullResult;
  push: PushResult;
}> {
  const pull = await pullSnapshot(userId);
  const push = await pushSnapshot(userId);

  // A conflict here means a third device uploaded during our push. One more
  // pull-then-push closes that race; beyond it, the next scheduled sync will.
  if (push.status === 'conflict') {
    await pullSnapshot(userId);
    return { pull, push: await pushSnapshot(userId) };
  }

  return { pull, push };
}
