/**
 * Running a Drive → Sheets import.
 *
 * Like the Keep and Docs imports this runs in the browser, and for the same
 * reason: a spreadsheet's body is end-to-end encrypted, so the DEK exists only
 * on the device. A server-side importer could only write plaintext the editor
 * would then fail to decrypt.
 *
 * Per spreadsheet the sequence mirrors what the editor does on a first save:
 * convert the file to the editor's `SheetFile` JSON, create the spreadsheet,
 * mint a DEK and register it, upload the ciphertext as `sheet.json`, and hand
 * the flattened cell text to the local search index.
 *
 * What does not come across: cell colours, fonts and borders (Takeout's .xlsx
 * carries them, but the styling SheetJS's community build reads back is too
 * partial to be worth half-applying), charts, pivot tables, filters,
 * conditional formatting, data validation, notes and comments, protected
 * ranges, and the original created and modified dates — the API sets those to
 * the time of the import. Number formats, merged cells, column widths and row
 * heights do come across (`sheetXlsx.ts`). Spreadsheets are imported into the
 * folder tree the export recorded, but sharing is not reapplied, so an
 * imported copy is private to the importer.
 */

import {
  initSodium,
  loadKeyPair,
  generateFileKey,
  encryptFileKey,
  type KeyPair,
} from '@neutrino/e2e-crypto';
import { extractSheetText } from '@neutrino/api-sheets';
import {
  sheetsApi,
  driveAutosaveContent,
  driveAutosaveEncryptedContent,
  encryptionApi,
} from '@/lib/api';
import type { SheetFile } from '@/app/(apps)/sheets/editor/types';
import { indexOnSave } from '@/lib/searchIndexUpdate';
import { readSheetInfo, type DriveSheetEntry } from './driveSheets';
import { createFolderResolver } from './folders';
import { delimitedToSheetFile, xlsxToSheetFile, type SheetConversionOptions } from './sheetXlsx';
import { describeError, formatBytes, logFail, logStep, logWarn } from './log';
import { sanitiseTitle } from './titles';
import type { ImportItem, ImportProgress, ImportSummary } from './types';

/** The filename every spreadsheet body is stored under, as the editor writes it. */
const CONTENT_FILENAME = 'sheet.json';

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

/** Read one exported file and convert it into the editor's spreadsheet JSON. */
export async function convertDriveSheet(
  sheet: DriveSheetEntry,
  options: SheetConversionOptions,
): Promise<SheetFile> {
  switch (sheet.format) {
    case 'xlsx': {
      const bytes = await (await sheet.entry.blob()).arrayBuffer();
      logStep('sheets', `converting ${sheet.entry.path}`, { xlsx: formatBytes(bytes.byteLength) });
      return xlsxToSheetFile(bytes, options);
    }
    case 'csv':
      return delimitedToSheetFile(
        await sheet.entry.text(),
        { name: sheet.title, separator: ',' },
        options,
      );
    case 'tsv':
      return delimitedToSheetFile(
        await sheet.entry.text(),
        { name: sheet.title, separator: '\t' },
        options,
      );
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
async function titleFor(sheet: DriveSheetEntry): Promise<string> {
  const info = await readSheetInfo(sheet.info);
  return sanitiseTitle(info?.title ?? '') || sanitiseTitle(sheet.title) || UNTITLED_SHEET;
}

// ── The import ────────────────────────────────────────────────────────────────

/**
 * Encrypt a spreadsheet's content the way the editor's first save does, and
 * register the DEK so the editor can decrypt it later.
 */
async function saveEncrypted(sheetId: string, content: string, keyPair: KeyPair): Promise<void> {
  const dek = generateFileKey();
  await encryptionApi.setFileKey(sheetId, { encryptedFileKey: encryptFileKey(dek, keyPair.publicKey) });
  await driveAutosaveEncryptedContent(sheetId, content, CONTENT_FILENAME, dek);
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

  // Without a key pair on this device there is nothing to encrypt with. The
  // editor tolerates plaintext content, so the import still runs — the caller
  // surfaces `unencrypted` so the user knows.
  await initSodium();
  const keyPair = userId ? loadKeyPair(userId) : null;
  if (!keyPair) {
    logWarn('sheets', 'no key pair on this device — spreadsheets will be saved as plaintext', { userId });
  }

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
    unencrypted: !keyPair,
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
      title = await titleFor(sheet);

      if (existingTitles.has(title.trim().toLowerCase())) {
        logStep('sheets', `skipping ${file}`, { title, reason: 'title already exists' });
        items.push({ file, title, status: 'skipped', reason: 'A spreadsheet with this title already exists' });
        onProgress?.({ done: items.length, total: sheets.length, current: title });
        continue;
      }

      step = 'converting the file';
      const content = JSON.stringify(await convertDriveSheet(sheet, options));

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
      // fine: a spreadsheet is one JSON record per non-empty cell, so a big
      // export is tens of megabytes of them.
      logStep('sheets', `saving ${title}`, { id: created.id, body: formatBytes(content.length), encrypted: !!keyPair });

      step = keyPair ? 'saving the encrypted body' : 'saving the body';
      if (keyPair) await saveEncrypted(created.id, content, keyPair);
      else await driveAutosaveContent(created.id, content, CONTENT_FILENAME);

      step = 'indexing it for search';
      indexOnSave(userId, {
        id: created.id,
        type: 'spreadsheet',
        title,
        content: extractSheetText(content),
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
