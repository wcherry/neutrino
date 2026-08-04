/**
 * Encrypted search-index snapshot sync.
 *
 * There is no server-side search — see `web/packages/search`. These endpoints
 * only store the encrypted blob one device uploads so the user's other devices
 * can restore it instead of re-fetching and re-decrypting every document.
 *
 * The server holds ciphertext and a wrapped key it cannot open; nothing here
 * sends plaintext terms anywhere.
 */

import { ApiClientError, BASE_URL, getAuthHeader, request } from '@neutrino/api-core';

/** Error code the upload rejects with when the stored version has moved on. */
export const SNAPSHOT_VERSION_CONFLICT = 'SNAPSHOT_VERSION_CONFLICT';

export interface SnapshotMeta {
  /**
   * Optimistic-concurrency token. Send it back as `expectedVersion` on the next
   * upload; the server rejects the write if it no longer matches.
   */
  version: number;
  sizeBytes: number;
  /** The snapshot's data key, sealed to the user's own public key. */
  wrappedKey: string;
  /** Which device wrote it — lets a client skip downloading its own upload. */
  deviceId: string | null;
  updatedAt: string;
}

export interface UploadSnapshotParams {
  /**
   * The version this client last saw. Omit it to assert nothing is stored yet,
   * which fails against an existing snapshot rather than overwriting it.
   */
  expectedVersion?: number;
  /** Overwrite whatever is stored, whatever its version. */
  force?: boolean;
  wrappedKey: string;
  deviceId: string;
}

export function isSnapshotConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === SNAPSHOT_VERSION_CONFLICT;
}

/** True when the server has no snapshot for this user yet. */
export function isSnapshotMissing(error: unknown): boolean {
  return error instanceof ApiClientError && error.statusCode === 404;
}

export const searchSnapshotApi = {
  /**
   * Snapshot metadata, or `null` when nothing is stored. Cheap enough to poll:
   * it never touches the blob.
   */
  async getMeta(): Promise<SnapshotMeta | null> {
    try {
      return await request<SnapshotMeta>('/api/v1/search/index/meta');
    } catch (error) {
      if (isSnapshotMissing(error)) return null;
      throw error;
    }
  },

  /** The encrypted snapshot bytes, or `null` when nothing is stored. */
  async download(): Promise<Uint8Array | null> {
    try {
      const blob = await request<Blob>(
        '/api/v1/search/index',
        {},
        { responseType: 'blob' },
      );
      return new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      if (isSnapshotMissing(error)) return null;
      throw error;
    }
  },

  /**
   * Replace the stored snapshot.
   *
   * Rejects with an `ApiClientError` carrying `SNAPSHOT_VERSION_CONFLICT` when
   * `expectedVersion` no longer matches — see `isSnapshotConflict`.
   *
   * This goes through `fetch` directly rather than the shared `request`
   * helper: the body is raw bytes, and `request` sets a JSON content type on
   * anything that is not `FormData`.
   */
  async upload(ciphertext: Uint8Array, params: UploadSnapshotParams): Promise<SnapshotMeta> {
    const query = new URLSearchParams();
    if (params.expectedVersion !== undefined) {
      query.set('expectedVersion', String(params.expectedVersion));
    }
    if (params.force) query.set('force', 'true');
    query.set('wrappedKey', params.wrappedKey);
    query.set('deviceId', params.deviceId);

    const res = await fetch(`${BASE_URL}/api/v1/search/index?${query.toString()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...getAuthHeader() },
      // `Uint8Array` is not a valid `BodyInit` under every TS DOM lib version;
      // its backing buffer always is.
      body: ciphertext.slice().buffer as ArrayBuffer,
    });

    if (!res.ok) {
      let code = 'UNKNOWN_ERROR';
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        // Not a JSON error envelope; keep the status-derived defaults.
      }
      throw new ApiClientError(res.status, code, message);
    }

    return (await res.json()) as SnapshotMeta;
  },

  /** Discard the stored snapshot. Local indexes are unaffected. */
  async remove(): Promise<void> {
    await request<void>('/api/v1/search/index', { method: 'DELETE' }, { responseType: 'none' });
  },
};
