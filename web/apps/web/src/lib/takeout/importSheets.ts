/**
 * Running a Drive → Sheets import.
 *
 * Like the Keep and Docs imports this runs in the browser, and for the same
 * reason: a spreadsheet's body is end-to-end encrypted, so the DEK exists only
 * on the device. A server-side importer could only write plaintext the editor
 * would then fail to decrypt.
 *
 * Per spreadsheet the sequence mirrors what the editor does on a first save:
 * convert the file to the editor's `SheetFile` JSON, pack that model into an
 * `.xlsx` (`sheetXlsx.ts`), create the spreadsheet, mint a DEK and register it,
 * upload the ciphertext of the package, and hand the flattened cell text to the
 * local search index. The package is what the file is stored as now, and
 * writing the bespoke JSON instead is what left every imported spreadsheet
 * unopenable — issue #169.
 *
 * What does not come across: cell colours, fonts and borders (Takeout's .xlsx
 * carries them, but the styling SheetJS's community build reads back is too
 * partial to be worth half-applying), charts, pivot tables, filters,
 * conditional formatting, data validation, notes and comments, protected
 * ranges. Number formats, merged cells, column widths and row heights do come
 * across (`sheetXlsx.ts`), as do the created and modified dates the file had
 * in Drive — written after the body, since saving it is what stamps the file
 * with the current time (`importMetadata.ts`). Spreadsheets are imported into
 * the folder tree the export recorded, but sharing is not reapplied, so an
 * imported copy is private to the importer.
 */

import {
  initSodium,
  loadKeyPair,
  activeKeyVersion,
  generateFileKey,
  encryptFileKey,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { extractSheetText } from '@neutrino/api-sheets';
import {
  sheetsApi,
  driveAutosaveEncryptedBytes,
  encryptionApi,
} from '@/lib/api';
import type { SheetFile } from '@/app/(apps)/sheets/editor/types';
import { withOoxmlExtension } from '@/lib/officeFormats';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { readSheetInfo, type DriveSheetEntry, type DriveSheetInfo } from './driveSheets';
import { createFolderResolver } from './folders';
import { applyImportMetadata, datesFor } from './importMetadata';
import {
  delimitedToSheetFile,
  sheetFileToXlsx,
  type SheetConversionOptions,
} from './sheetXlsx';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import { sanitiseTitle } from './titles';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

export const UNTITLED_SHEET = 'Untitled spreadsheet';

export interface SheetsImportOptions extends SheetConversionOptions {
  /** Recreate the folder tree the export recorded, under the destination folder. */
  preserveFolders: boolean;
  /** Skip a spreadsheet whose title already exists, so a re-run doesn't duplicate. */
  skipExisting: boolean;
  /** Folder to import into; `null` puts the spreadsheets at the drive root. */
  folderName: string | null;
}

export const DEFAULT_SHEETS_IMPORT_OPTIONS: SheetsImportOptions = {
  preserveFolders: true,
  skipExisting: true,
  folderName: 'Google Sheets',
  // On by default: a spreadsheet without its formulas is a screenshot of one.
  // The cost is that a formula Neutrino cannot evaluate shows as its own text
  // rather than as the value Google last computed, which is what turning this
  // off avoids — at the price of every formula in the file.
  importFormulas: true,
};

export interface RunSheetsImportArgs {
  sheets: DriveSheetEntry[];
  options: SheetsImportOptions;
  /** The signed-in user; needed to find their key pair and index their spreadsheets. */
  userId: string | undefined;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
}

// ── Conversion ────────────────────────────────────────────────────────────────

/**
 * One exported file as the `.xlsx` bytes to store for it.
 *
 * A Google Sheet is exported as an `.xlsx` and a spreadsheet is stored as an
 * `.xlsx`, so that case is a copy: the export goes in as it came out, and the
 * editor opens it with `readXlsx` exactly as it opens any other workbook in
 * Drive. Nothing is converted, so nothing is lost — the styling, number
 * formats, charts and pivot tables that only Google put in the file are all
 * still in it.
 *
 * `.csv` and `.tsv` have no workbook to keep, so they convert (`sheetXlsx.ts`)
 * and are written out by `writeXlsx`.
 */
export async function storedXlsxFor(
  sheet: DriveSheetEntry,
  options: SheetConversionOptions,
): Promise<Uint8Array> {
  if (sheet.format === 'xlsx') {
    const bytes = new Uint8Array(await (await sheet.entry.blob()).arrayBuffer());
    logStep('sheets', `storing ${sheet.entry.path} as exported`, { xlsx: formatBytes(bytes.byteLength) });
    return bytes;
  }
  const model = await delimitedToSheetFile(
    await sheet.entry.text(),
    { name: sheet.title, separator: sheet.format === 'tsv' ? '\t' : ',' },
    options,
  );
  const bytes = await sheetFileToXlsx(model);
  logStep('sheets', `converted ${sheet.entry.path}`, {
    from: sheet.format,
    xlsx: formatBytes(bytes.byteLength),
  });
  return bytes;
}

/**
 * The text to index a stored spreadsheet by, read back out of the bytes that
 * were stored.
 *
 * Read back rather than kept from the conversion, because for an `.xlsx` export
 * there is no conversion to keep it from — and reading it with `readXlsx`, the
 * reader the editor opens the file with, means the index holds what the editor
 * will show. It doubles as a check that the stored file parses at all.
 *
 * A failure here is a warning, not a failed import: the spreadsheet is already
 * saved by the time this runs, and reporting a stored file as a failed one
 * invites a second import of the whole archive.
 */
async function indexTextFor(bytes: Uint8Array, file: string): Promise<string> {
  try {
    const { readXlsx } = await import('@/lib/ooxml/xlsx/read');
    return extractSheetText(JSON.stringify(await readXlsx(bytes)));
  } catch (err) {
    logWarn('sheets', 'could not read the stored spreadsheet back for the search index', {
      file,
      error: describeError(err),
    });
    return '';
  }
}

/**
 * The title to give an imported spreadsheet.
 *
 * As with documents the sidecar's title wins over the filename, because
 * Takeout rewrites filenames — characters it cannot store are replaced and
 * `(1)` is appended to disambiguate — while the sidecar records what the
 * spreadsheet was really called.
 */
function titleFor(sheet: DriveSheetEntry, info: DriveSheetInfo | null): string {
  return sanitiseTitle(info?.title ?? '') || sanitiseTitle(sheet.title) || UNTITLED_SHEET;
}

// ── The import ────────────────────────────────────────────────────────────────

/**
 * Encrypt a spreadsheet's package the way the editor's first save does, and
 * register the DEK so the editor can decrypt it later.
 *
 * The bytes go through the binary-safe transport, never the string one: the
 * package is a zip, and a `TextEncoder` round trip through it is not a package
 * any more.
 */
async function saveEncrypted(
  sheetId: string,
  bytes: Uint8Array,
  filename: string,
  keyPair: KeyPair,
  userId: string,
): Promise<void> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(sheetId, {
    encryptedFileKey: encryptFileKey(dek, keyPair.publicKey),
    keyVersion: activeKeyVersion(userId) ?? undefined,
  });
  await driveAutosaveEncryptedBytes(sheetId, bytes, filename, dek);
}

export async function runSheetsImport({
  sheets,
  options,
  userId,
  onProgress,
  signal,
}: RunSheetsImportArgs): Promise<ImportSummary> {
  const items: ImportItem[] = [];

  logStep('sheets', `starting: ${sheets.length} spreadsheet${sheets.length === 1 ? '' : 's'}`, {
    options,
    userId,
  });

  // Without a key pair on this device there is nothing to encrypt with, and an
  // import that writes plaintext leaves every item it touched with no key ref
  // and no way back (issue #95). So the run stops here, before the first
  // write, and the page tells the user to unlock and try again — a declined
  // import can be re-run in full; a plaintext one cannot be undone.
  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair || !userId) {
    logWarn('sheets', 'no key pair on this device — refusing to import, nothing was written', { userId });
    return {
      total: sheets.length,
      imported: 0,
      skipped: 0,
      failed: 0,
      items: [],
      folderId: null,
      cancelled: true,
      unencrypted: true,
    } as ImportSummary;
  }
  // Narrowed together, and now unconditional: everything below encrypts.
  const encrypting = { keyPair, userId };


  const folders = createFolderResolver();
  const destination = options.folderName?.trim() ? [options.folderName.trim()] : [];
  const folderId = await folders.folderFor(destination);
  logStep('sheets', 'destination resolved', { folder: destination.join('/') || '(drive root)', folderId });

  const summary = (extra: Partial<ImportSummary> = {}): ImportSummary => ({
    total: sheets.length,
    imported: items.filter((i) => i.status === 'imported').length,
    skipped: items.filter((i) => i.status === 'skipped').length,
    failed: items.filter((i) => i.status === 'failed').length,
    items,
    folderId,
    cancelled: false,
    unencrypted: false,
    ...extra,
  });

  // Titles that already exist, so a second run over the same export is a no-op
  // rather than a second copy of every spreadsheet. Only pre-existing titles
  // count: two exported spreadsheets that genuinely share a title should both
  // come across.
  const existingTitles = new Set<string>();
  if (options.skipExisting) {
    const existing = await sheetsApi.listSheets();
    for (const sheet of existing.sheets) existingTitles.add(sheet.title.trim().toLowerCase());
    logStep('sheets', `${existingTitles.size} existing title${existingTitles.size === 1 ? '' : 's'} to skip against`);
  }

  for (const sheet of sheets) {
    if (signal?.aborted) {
      logStep('sheets', 'stopped by the user', { done: items.length, remaining: sheets.length - items.length });
      return summary({ cancelled: true });
    }

    const file = sheet.entry.path;
    let title = sheet.title;
    // Which step we reached, so the failure log says what was being attempted
    // rather than only what went wrong.
    let step = 'reading the title';
    try {
      // One read of the sidecar: it holds the real title and the dates Drive
      // had for the file, and it is a separate entry to inflate out of the zip.
      const info = await readSheetInfo(sheet.info);
      title = titleFor(sheet, info);

      if (existingTitles.has(title.trim().toLowerCase())) {
        logStep('sheets', `skipping ${file}`, { title, reason: 'title already exists' });
        items.push({ file, title, status: 'skipped', reason: 'A spreadsheet with this title already exists' });
        onProgress?.({ done: items.length, total: sheets.length, current: title });
        continue;
      }

      step = 'reading the file';
      const bytes = await storedXlsxFor(sheet, options);

      step = 'resolving its folder';
      const parentId =
        options.preserveFolders && sheet.path.length > 0
          ? await folders.folderFor([...destination, ...sheet.path])
          : folderId;

      step = 'creating the spreadsheet';
      // Drive seeds an empty workbook body of its own on create; the save
      // below replaces it with the converted one.
      const created = await sheetsApi.createSheet({ title, folderId: parentId });

      // Body size is the usual reason a save is rejected where a create was
      // fine: a big export is tens of megabytes of workbook.
      logStep('sheets', `saving ${title}`, {
        id: created.id,
        body: formatBytes(bytes.byteLength),
        encrypted: true,
      });

      step = 'saving the encrypted body';
      await saveEncrypted(
        created.id,
        bytes,
        withOoxmlExtension(title, 'sheets'),
        encrypting.keyPair,
        encrypting.userId,
      );

      // After the body, not before: saving it is what stamps the file with the
      // current time, so dates written any earlier would be overwritten here.
      step = 'recording the dates it had in Drive';
      await applyImportMetadata({
        fileId: created.id,
        scope: 'sheets',
        source: sheet.entry.fullPath,
        dates: datesFor(sheet.entry, { createdAt: info?.createdAt, updatedAt: info?.modifiedAt }),
      });

      step = 'indexing it for search';
      indexOnSave(userId, {
        id: created.id,
        type: 'spreadsheet',
        title,
        content: await indexTextFor(bytes, file),
      });

      items.push({ file, title, status: 'imported' });
    } catch (err) {
      logFail('sheets', `failed while ${step}`, err, { file, title, format: sheet.format, folders: sheet.path });
      items.push({ file, title, status: 'failed', reason: describeError(err) });
    }

    onProgress?.({ done: items.length, total: sheets.length, current: title });
  }

  const result = summary();
  logStep('sheets', 'finished', {
    imported: result.imported,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}
