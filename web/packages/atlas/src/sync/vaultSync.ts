import { threeWayMerge } from './merge';
import { type SyncRecord, type Vault, compare, syncRecord } from './vault';

/** A file in the vault's Drive folder tree, as the server lists it. */
export interface RemoteFile {
  id: string;
  /** Vault-relative path, `/`-separated, built from the Drive folder names. */
  path: string;
  /** Drive's `content_version`: bumped by every content write. */
  version: number;
}

export type VaultRemoteErrorCode =
  /**
   * A guarded write lost the race: the server's content moved on (Drive's 409
   * `CONTENT_VERSION_CONFLICT`).
   */
  | 'conflict'
  /** The file is gone (deleted or trashed on another device). */
  | 'notFound'
  /**
   * The file's content can't be decrypted here: it was sealed to a key this device doesn't
   * hold. Sync leaves it out of the pass, reports it, and tries again next time.
   */
  | 'unreadable';

export class VaultRemoteError extends Error {
  constructor(
    readonly code: VaultRemoteErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'VaultRemoteError';
  }
}

const isRemoteError = (e: unknown, code: VaultRemoteErrorCode) => e instanceof VaultRemoteError && e.code === code;

/**
 * The vault on the server: a Drive folder tree whose files hold encrypted content. The Drive
 * adapter (`DriveVaultRemote`) does the HTTP, the folders, and the encryption with
 * `@neutrino/e2e-crypto`. Sync only sees plaintext bytes and paths.
 */
export interface VaultRemote {
  /** Every file in the vault. */
  list(): Promise<RemoteFile[]>;
  /** A file's content, and the `content_version` that content is. */
  download(id: string): Promise<{ data: Uint8Array; version: number }>;
  /** Creates a file at `path`, making any folders it needs. */
  create(path: string, data: Uint8Array): Promise<RemoteFile>;
  /**
   * Replaces a file's content if the server is still at `expectedVersion` (else
   * `VaultRemoteError('conflict')`). Returns the new version.
   */
  replace(id: string, data: Uint8Array, expectedVersion: number): Promise<number>;
  /** Renames or moves a file, making any folders it needs. */
  move(id: string, path: string): Promise<void>;
  /** Moves a file to the trash. */
  delete(id: string): Promise<void>;
}

/**
 * What one sync pass did, so the app can update the index and tell the user about conflicts.
 */
export interface SyncReport {
  /** Files whose local content changed: pulled, merged, or the page side of a conflict. */
  updated: string[];
  /** Files uploaded or pushed. */
  uploaded: string[];
  /** Local edits merged with remote edits, line by line. */
  merged: string[];
  /** Files deleted locally because they were deleted elsewhere. */
  removed: string[];
  /** Files deleted on the server because they were deleted here. */
  deletedRemotely: string[];
  /** Files moved locally to follow a move elsewhere. */
  moved: { from: string; to: string }[];
  /**
   * Both sides changed the same lines: both versions kept. `path` holds the server's version,
   * `copy` this device's.
   */
  conflicts: { path: string; copy: string }[];
  /** Files edited here but deleted elsewhere: uploaded again rather than lost. */
  restored: string[];
  /**
   * Files on the server this device can't decrypt, left as they were here; the rest of the
   * pass went ahead.
   */
  unreadable: string[];
}

export const emptySyncReport = (): SyncReport => ({
  updated: [],
  uploaded: [],
  merged: [],
  removed: [],
  deletedRemotely: [],
  moved: [],
  conflicts: [],
  restored: [],
  unreadable: [],
});

/** True when a pass did nothing. */
export function isQuiet(report: SyncReport): boolean {
  return Object.values(report).every((list: unknown[]) => list.length === 0);
}

/**
 * Two-way sync between a `Vault` and its `VaultRemote`. A port of AtlasKit's `VaultSync`; the
 * two must keep behaving the same, since a vault is synced by both.
 *
 * One `sync()` pass lists the server and reconciles every file. It never discards a change:
 * - an edit here and an edit there are merged line by line (`threeWayMerge`);
 * - when that's impossible, the server's version keeps the page and this device's goes to a
 *   conflicted copy beside it;
 * - an edit to a file deleted elsewhere brings the file back.
 *
 * Each file's outcome is committed only after the server accepted it. A pass interrupted by a
 * network error leaves everything consistent, and the next pass carries on from there. Local
 * edits may go on during a pass, as on the Mac, where they interleave at network calls.
 */
export class VaultSync {
  /** When conflicted copies are stamped with. Injectable so tests are deterministic. */
  now: () => Date = () => new Date();

  constructor(
    readonly vault: Vault,
    readonly remote: VaultRemote,
  ) {}

  async sync(): Promise<SyncReport> {
    const report = emptySyncReport();
    const listing = await this.resolvingDuplicatePaths(await this.remote.list());
    const byID = new Map(listing.map((f) => [f.id, f]));
    const seen = new Set<string>();

    // 1. Files this device has synced before. Tracked by file id, not path: an earlier step in
    // this pass may have moved a record aside, and it must still be reconciled, once.
    for (const id of this.vault.records.flatMap((r) => (r.fileID ? [r.fileID] : []))) {
      if (byID.has(id)) seen.add(id);
      const current = this.vault.recordForFile(id);
      if (!current) continue; // forgotten earlier in this pass
      const file = byID.get(id);
      if (file) await this.reconcile(current, file, report);
      else await this.reconcileDeletedRemotely(current, report);
    }

    // 2. Files the server has that this device doesn't know: new elsewhere. One record per file
    // id, always: a second would share the first's merge base.
    for (const file of listing) {
      if (seen.has(file.id) || this.vault.recordForFile(file.id)) continue;
      const local = this.vault.record(file.path);
      if (local && local.fileID === null) {
        // Created on both sides at the same path: adopt it if the content matches, otherwise
        // keep both.
        seen.add(file.id);
        await this.adoptOrKeepBoth(local, file, report);
      } else {
        await this.makeRoom(file.path, file.id);
        await this.pull(file, file.path, report);
      }
    }

    // 3. Files created on this device (conflicted copies from step 1 and 2 included).
    for (const record of this.vault.records) {
      if (record.fileID === null && !record.deleted) await this.upload(record, report);
    }
    return report;
  }

  // ── Synced files ───────────────────────────────────────────────────────────

  private async reconcile(record: SyncRecord, file: RemoteFile, report: SyncReport): Promise<void> {
    if (record.deleted) {
      if (file.version === record.baseVersion) {
        await ignoringNotFound(() => this.remote.delete(file.id));
        await this.vault.forget(record.path);
        report.deletedRemotely.push(record.path);
      } else {
        // Edited elsewhere after this device deleted it: the edit wins.
        await this.vault.forget(record.path);
        await this.makeRoom(file.path, file.id);
        await this.pull(file, file.path, report);
      }
      return;
    }

    // Paths. A move on one side follows to the other; if both moved, the server's wins.
    const movedHere = record.path !== record.basePath;
    const movedThere = file.path !== record.basePath;
    if (movedThere && file.path !== record.path) {
      await this.makeRoom(file.path, file.id);
      await this.vault.relocate(record.path, file.path);
      report.moved.push({ from: record.path, to: file.path });
      record = { ...record, path: file.path, basePath: file.path };
      await this.vault.commit(record, null, null);
    } else if (movedHere) {
      await this.remote.move(file.id, record.path);
      record = { ...record, basePath: record.path };
      await this.vault.commit(record, null, null);
    }

    // Content.
    const changedThere = file.version !== record.baseVersion;
    if (!record.dirty && !changedThere) return;
    if (!record.dirty) {
      await this.pull(file, record.path, report);
    } else if (!changedThere) {
      try {
        await this.push(record, file.version, report);
      } catch (e) {
        if (!isRemoteError(e, 'conflict')) throw e;
        await this.merge(record, report);
      }
    } else {
      await this.merge(record, report);
    }
  }

  private async reconcileDeletedRemotely(record: SyncRecord, report: SyncReport): Promise<void> {
    if (record.deleted || !record.dirty) {
      await this.vault.forget(record.path);
      if (!record.deleted) report.removed.push(record.path);
    } else {
      // Edited here, deleted elsewhere: upload it again rather than lose the edit.
      await this.vault.commit({ ...record, fileID: null, baseVersion: null, basePath: null }, null, null);
      report.restored.push(record.path);
    }
  }

  // ── Transfers ──────────────────────────────────────────────────────────────

  private async pull(file: RemoteFile, path: string, report: SyncReport): Promise<void> {
    let downloaded: { data: Uint8Array; version: number };
    try {
      downloaded = await this.remote.download(file.id);
    } catch (e) {
      if (!isRemoteError(e, 'unreadable')) throw e;
      // One file this device can't open mustn't stop the rest of the vault syncing. Its record
      // is untouched, so the next pass tries it again.
      report.unreadable.push(path);
      return;
    }
    const { data, version } = downloaded;
    const record = syncRecord(path, { fileID: file.id, baseVersion: version, basePath: file.path });
    await this.vault.commit(record, data, keepsBase(path) ? data : null);
    report.updated.push(path);
  }

  private async push(record: SyncRecord, expectedVersion: number, report: SyncReport): Promise<void> {
    const data = await this.vault.content(record.path);
    if (!record.fileID || !data) return;
    const version = await this.remote.replace(record.fileID, data, expectedVersion);
    await this.vault.commit({ ...record, baseVersion: version, dirty: false }, null, keepsBase(record.path) ? data : null);
    report.uploaded.push(record.path);
  }

  private async upload(record: SyncRecord, report: SyncReport): Promise<void> {
    const data = await this.vault.content(record.path);
    if (!data) return;
    const file = await this.remote.create(record.path, data);
    const synced = syncRecord(record.path, { fileID: file.id, baseVersion: file.version, basePath: file.path });
    await this.vault.commit(synced, null, keepsBase(record.path) ? data : null);
    report.uploaded.push(record.path);
  }

  /**
   * Both sides changed the file. Merge the text line by line and push the result; if that isn't
   * possible, the server's version takes the page and this device's goes to a copy.
   */
  private async merge(record: SyncRecord, report: SyncReport): Promise<void> {
    const id = record.fileID;
    const local = await this.vault.content(record.path);
    if (!id || !local) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: theirs, version } = await this.remote.download(id);
      const base = keepsBase(record.path) ? await this.vault.base(id) : null;
      const merged = base === null ? null : threeWayMerge(utf8(base), utf8(local), utf8(theirs));
      if (merged !== null) {
        const data = new TextEncoder().encode(merged);
        try {
          const newVersion = await this.remote.replace(id, data, version);
          await this.vault.commit({ ...record, baseVersion: newVersion, dirty: false }, data, data);
          report.merged.push(record.path);
          report.updated.push(record.path);
          return;
        } catch (e) {
          if (!isRemoteError(e, 'conflict')) throw e;
          continue; // It moved again while we merged: merge with the newer version.
        }
      }
      await this.keepBoth(record, local, theirs, version, report);
      return;
    }
    // Still racing after three tries: keep both rather than loop.
    const { data: theirs, version } = await this.remote.download(id);
    await this.keepBoth(record, local, theirs, version, report);
  }

  private async keepBoth(record: SyncRecord, local: Uint8Array, theirs: Uint8Array, version: number, report: SyncReport): Promise<void> {
    const copy = this.conflictedCopyPath(record.path);
    await this.vault.write(local, copy); // a new local file; step 3 uploads it
    await this.vault.commit({ ...record, baseVersion: version, dirty: false }, theirs, keepsBase(record.path) ? theirs : null);
    report.conflicts.push({ path: record.path, copy });
    report.updated.push(record.path);
  }

  /** The same path created here and elsewhere before either synced. */
  private async adoptOrKeepBoth(local: SyncRecord, file: RemoteFile, report: SyncReport): Promise<void> {
    const { data: theirs, version } = await this.remote.download(file.id);
    const mine = await this.vault.content(local.path);
    if (mine && !equalBytes(mine, theirs)) {
      const copy = this.conflictedCopyPath(local.path);
      await this.vault.write(mine, copy);
      report.conflicts.push({ path: local.path, copy });
    }
    const record = syncRecord(local.path, { fileID: file.id, baseVersion: version, basePath: file.path });
    await this.vault.commit(record, theirs, keepsBase(local.path) ? theirs : null);
    report.updated.push(local.path);
  }

  // ── Path collisions ────────────────────────────────────────────────────────

  /**
   * Drive allows two files with the same name in a folder; the vault doesn't. When the server
   * lists several files at one path, the one with the smallest id keeps it and the others are
   * moved to a name made from their id. Every device computes the same names, so devices that
   * notice at the same time agree instead of moving files back and forth.
   */
  private async resolvingDuplicatePaths(listing: RemoteFile[]): Promise<RemoteFile[]> {
    const byPath = new Map<string, RemoteFile[]>();
    for (const file of listing) byPath.set(file.path, [...(byPath.get(file.path) ?? []), file]);
    const out: RemoteFile[] = [];
    for (const [path, files] of byPath) {
      const sorted = [...files].sort((a, b) => compare(a.id, b.id));
      out.push(sorted[0]);
      for (const file of sorted.slice(1)) {
        const aside = asidePath(path, file.id);
        await ignoringNotFound(() => this.remote.move(file.id, aside));
        out.push({ ...file, path: aside });
      }
    }
    return out.sort((a, b) => compare(a.id, b.id));
  }

  /**
   * Clears `path` for the server file `incomingID`. A different local file there is one this
   * device moved or created and hasn't pushed yet: the server's claim wins, and the local file
   * steps aside (to a name made from its id, or a conflicted-copy name if it has none). Its move
   * then reaches the server on the next pass.
   */
  private async makeRoom(path: string, incomingID: string): Promise<void> {
    const occupant = this.vault.record(path);
    if (!occupant || occupant.deleted || occupant.fileID === incomingID) return;
    const aside = occupant.fileID ? asidePath(path, occupant.fileID) : this.conflictedCopyPath(path);
    await this.vault.relocate(path, aside);
  }

  /** `Folder/Title (conflicted copy 2026-10-29 1405).md`, numbered if that's taken. */
  conflictedCopyPath(path: string): string {
    const d = this.now();
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
    const [stem, ext] = splitExtension(path);
    let candidate = `${stem} (conflicted copy ${stamp})${ext}`;
    for (let n = 2; this.vault.record(candidate); n++) candidate = `${stem} (conflicted copy ${stamp} ${n})${ext}`;
    return candidate;
  }
}

/** `Folder/Title (conflicted copy f123).md`: the same on every device. */
export function asidePath(path: string, fileID: string): string {
  const [stem, ext] = splitExtension(path);
  return `${stem} (conflicted copy ${fileID})${ext}`;
}

export function splitExtension(path: string): [string, string] {
  const dot = path.lastIndexOf('.');
  if (dot < 0 || path.slice(dot).includes('/')) return [path, ''];
  return [path.slice(0, dot), path.slice(dot)];
}

/** Only text pages keep a base copy: it is what a three-way merge needs, and attachments aren't merged. */
export function keepsBase(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

async function ignoringNotFound(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (e) {
    if (!isRemoteError(e, 'notFound')) throw e;
  }
}

/** Lenient UTF-8, as Swift's `String(decoding:as:)`: bad bytes become U+FFFD, and a BOM stays. */
export const utf8 = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
