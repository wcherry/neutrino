/**
 * Running a local folder import.
 *
 * Every file goes up through `uploadDriveFile` — the same encrypted pipeline as
 * Drive's own Upload: a DEK per file, sealed to the user's public key, encrypted
 * metadata and an on-device thumbnail. Nothing here touches the bytes; the
 * picked `File` is wrapped (a Blob view, no copy) only to give it its base name
 * and the mime type it uploads with, and the pipeline reads it when it encrypts.
 *
 * What differs per product is the step after the upload: a photo is registered
 * with the Photos library (classified as a Live/Motion photo first, while the
 * bytes are still plaintext), a note is indexed for search, and every file then
 * gets its own dates and its relative path as provenance — the same second call
 * the Takeout runners make (`applyImportMetadata`).
 *
 * Uploads run three at a time (`LOCAL_IMPORT_CONCURRENCY`). Each one holds its
 * file in memory while it is encrypted, so the pool is what bounds the tab's
 * memory on a ten-thousand-file import; more than a few in flight buys little,
 * since they share one connection to one server.
 */

import { readMotionPhotoInfo as readMotionPhotoInfoImpl, type PhotoMetadata } from '@neutrino/api-photos';
import { isMissingEncryptionKey } from '@neutrino/api-drive';
import { canEncryptFor, photosApi, uploadDriveFile } from '@/lib/api';
import type { ImportStep } from '@/components/ImportRun';
import { createFolderResolver, type FolderResolver } from '@/lib/takeout/folders';
import {
  applyImportMetadata as applyImportMetadataImpl,
  captureDateFromIso,
  isoFromDate,
} from '@/lib/takeout/importMetadata';
import { describeError, logFail, logStep } from '@/lib/takeout/log';
import type { ImportItem, ImportProgress, ImportSummary } from '@/lib/takeout/types';
import type { ImportProduct, PlannedFile } from './destinations';
import { runPool } from './pool';

export const LOCAL_IMPORT_CONCURRENCY = 3;

const SCOPE = 'local';

/** The vault locked part-way through: say so in words, not as the `no-dek` sentinel. */
const LOCKED_REASON = 'Your encryption keys were locked, so this file was not uploaded. Unlock them and retry.';

/** Everything the runner writes through, injectable so a test can watch it. */
export interface LocalImportDeps {
  upload(
    file: File,
    userId: string,
    opts: { folderId: string | null; onProgress?: (pct: number) => void },
  ): Promise<{ id: string }>;
  registerPhoto(body: {
    fileId: string;
    captureDate: string | null;
    metadata: { motionPhoto: unknown } | null;
  }): Promise<unknown>;
  readMotionPhotoInfo(file: File): Promise<unknown | null>;
  applyImportMetadata(args: {
    fileId: string;
    scope: string;
    source: string;
    dates: { createdAt?: string; updatedAt?: string };
  }): Promise<void>;
  indexNote(userId: string, note: { id: string; title: string; text: string }): void;
  canEncrypt(userId: string | null | undefined): Promise<boolean>;
  folderResolver: { folderFor(path: string[]): Promise<string | null> };
}

/** The real collaborators. The search index and note parser load on first use. */
function defaultDeps(baseFolderId: string | null): LocalImportDeps {
  return {
    upload: (file, userId, opts) => uploadDriveFile(file, userId, opts),
    registerPhoto: (body) =>
      photosApi.registerPhoto({
        fileId: body.fileId,
        captureDate: body.captureDate,
        // `motionPhoto` is `readMotionPhotoInfo`'s own result, passed back
        // untouched; the interface keeps it opaque so tests need not build one.
        metadata: body.metadata as PhotoMetadata | null,
      }),
    readMotionPhotoInfo: (file) => readMotionPhotoInfoImpl(file, { fileName: file.name, mimeType: file.type }),
    applyImportMetadata: (args) => applyImportMetadataImpl(args),
    indexNote: (userId, note) => {
      void Promise.all([import('@/lib/searchIndexUpdate'), import('@/lib/noteFiles')])
        .then(([{ indexOnSave }, { extractNoteText }]) =>
          indexOnSave(userId, { id: note.id, type: 'note', title: note.title, content: extractNoteText(note.text) }),
        )
        .catch((err) => logFail(SCOPE, `could not index ${note.title}`, err));
    },
    canEncrypt: (userId) => canEncryptFor(userId),
    folderResolver: createFolderResolver(baseFolderId),
  };
}

function resolveDeps(baseFolderId: string | null, deps?: Partial<LocalImportDeps>): LocalImportDeps {
  // An injected resolver wins over the default one: `buildLocalImportSteps`
  // passes one shared by every step, whose cache is the point.
  const resolved: LocalImportDeps = { ...defaultDeps(baseFolderId) };
  for (const key of Object.keys(deps ?? {}) as (keyof LocalImportDeps)[]) {
    const value = deps?.[key];
    if (value !== undefined) Object.assign(resolved, { [key]: value });
  }
  return resolved;
}

function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function directoriesOf(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0).slice(0, -1);
}

function noteTitleOf(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '') || name;
}

export interface RunLocalImportStepArgs {
  product: ImportProduct;
  files: PlannedFile[];
  /** The Drive folder the picked folders are recreated under; `null` is My Drive. */
  baseFolderId: string | null;
  userId: string | null | undefined;
  onProgress: (p: ImportProgress) => void;
  signal: AbortSignal;
  /** A retry: only these relative paths. */
  only?: ReadonlySet<string>;
  concurrency?: number;
  deps?: Partial<LocalImportDeps>;
}

/** One product's pass over the planned files. Never throws for a single file. */
export async function runLocalImportStep({
  product,
  files,
  baseFolderId,
  userId,
  onProgress,
  signal,
  only,
  concurrency = LOCAL_IMPORT_CONCURRENCY,
  deps: injected,
}: RunLocalImportStepArgs): Promise<ImportSummary> {
  const deps = resolveDeps(baseFolderId, injected);

  if (!userId || !(await deps.canEncrypt(userId))) {
    logStep(SCOPE, `not importing ${product}: this device cannot encrypt`, { files: files.length });
    return {
      total: files.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
      folderId: baseFolderId,
      cancelled: true,
      unencrypted: true,
    };
  }

  const selected = only ? files.filter((f) => only.has(f.source.path)) : files;
  const total = selected.length;
  // Slots by index, so the result lists files in the order they were picked
  // whatever order the pool finished them in.
  const slots: (ImportItem | undefined)[] = new Array(total);
  let done = 0;

  logStep(SCOPE, `importing ${total} into ${product}`, { baseFolderId });

  await runPool(
    selected,
    concurrency,
    async (planned, index) => {
      const { source } = planned;
      const path = source.path;
      const name = baseNameOf(path);
      let step = 'finding its folder';
      try {
        const folderId = await deps.folderResolver.folderFor(directoriesOf(path));

        step = 'uploading it';
        const upload = new File([source.file], name, {
          type: planned.mimeType,
          lastModified: source.file.lastModified,
        });
        const { id } = await deps.upload(upload, userId, { folderId });

        const iso = isoFromDate(new Date(source.file.lastModified));

        if (product === 'Photos') {
          step = 'adding it to Photos';
          const motionPhoto = await deps.readMotionPhotoInfo(upload);
          await deps.registerPhoto({
            fileId: id,
            captureDate: captureDateFromIso(iso) ?? null,
            metadata: motionPhoto ? { motionPhoto } : null,
          });
        } else if (product === 'Notes') {
          // Search is best-effort: an unindexed note is still a note.
          try {
            deps.indexNote(userId, { id, title: noteTitleOf(name), text: await source.file.text() });
          } catch (err) {
            logFail(SCOPE, `could not index ${path}`, err);
          }
        }

        await deps.applyImportMetadata({
          fileId: id,
          scope: SCOPE,
          source: path,
          dates: iso ? { createdAt: iso, updatedAt: iso } : {},
        });

        slots[index] = { file: path, title: name, status: 'imported' };
        logStep(SCOPE, `imported ${path}`, { id, folderId, product });
      } catch (err) {
        logFail(SCOPE, `failed ${step}: ${path}`, err, { product });
        slots[index] = {
          file: path,
          title: name,
          status: 'failed',
          reason: isMissingEncryptionKey(err) ? LOCKED_REASON : describeError(err),
        };
      } finally {
        done++;
        onProgress({ done, total, current: name });
      }
    },
    signal,
  );

  const items = slots.filter((item): item is ImportItem => item !== undefined);
  return {
    total,
    imported: items.filter((i) => i.status === 'imported').length,
    skipped: 0,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
    folderId: baseFolderId,
    cancelled: signal.aborted,
    unencrypted: false,
  };
}

const PRODUCT_ORDER: readonly ImportProduct[] = ['Photos', 'Drive', 'Notes'];

/**
 * The provider's steps for a planned import: Photos, Drive, Notes, in that
 * order, leaving out any with nothing in it. They share one folder resolver so
 * a folder holding both a photo and a document is found (or made) once.
 */
export function buildLocalImportSteps({
  planned,
  baseFolderId,
  userId,
  deps,
}: {
  planned: PlannedFile[];
  baseFolderId: string | null;
  userId: string | null | undefined;
  deps?: Partial<LocalImportDeps>;
}): ImportStep[] {
  const folderResolver: FolderResolver = deps?.folderResolver ?? createFolderResolver(baseFolderId);
  const shared: Partial<LocalImportDeps> = { ...deps, folderResolver };

  return PRODUCT_ORDER.flatMap((product): ImportStep[] => {
    const files = planned.filter((p) => p.product === product);
    if (files.length === 0) return [];
    return [
      {
        product,
        count: files.length,
        run: ({ onProgress, signal, only }) =>
          runLocalImportStep({ product, files, baseFolderId, userId, onProgress, signal, only, deps: shared }),
      },
    ];
  });
}
