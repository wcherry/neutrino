/**
 * The shape of a Drive export, shared by everything read out of one.
 *
 * Neither Docs nor Sheets is a product directory of its own: a Google Doc and
 * a Google Sheet are both Drive files, so both come out under `Takeout/Drive/`
 * in the folder tree the user had, converted on the way out to whatever format
 * the export was configured for, each optionally beside a `-info.json`
 * metadata sidecar:
 *
 *     Takeout/
 *       Drive/
 *         Meeting notes.docx
 *         Meeting notes.docx-info.json
 *         Work/
 *           Q3 plan.docx
 *           Budget.xlsx
 *           logo.png
 *
 * Two finders (`driveDocs.ts`, `driveSheets.ts`) walk that same tree looking
 * for different files in it, so locating the directory, pairing a file with
 * its sidecar and reading one live here rather than in either of them.
 */

import type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';
import { isoFromText } from './importMetadata';
import { describeError, logStep, logWarn } from './log';

// ── Locating the directory ────────────────────────────────────────────────────

/** Directory names Google uses for Drive. */
export const DRIVE_DIR_NAMES = ['drive', 'google drive', 'my drive'];

/** The product directory holding the most files with `ext`. */
function directoryWithMost(archive: TakeoutArchive, ext: string): TakeoutProductDir | null {
  let best: TakeoutProductDir | null = null;
  let bestCount = 0;
  for (const product of archive.products) {
    const count = product.entries.filter((e) => e.ext === ext).length;
    if (count > bestCount) {
      best = product;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The archive's Drive directory, or `null` when it has none.
 *
 * Google localises the directory's name, so a non-English export has to be
 * recognised by its contents instead. That is what `signalExt` is for: an
 * extension no other Takeout product emits, and so strong enough on its own to
 * say "this is Drive" — `.docx` for documents, `.xlsx` for spreadsheets. It is
 * deliberately never `.html`, `.txt` or `.csv`, all of which other products
 * write: Keep puts an `.html` beside every note and Contacts exports a `.csv`,
 * so sniffing for those would hand another product's files to this one.
 *
 * `scope` only names the log lines, so a run that reads the directory twice —
 * once for documents, once for spreadsheets — says which pass it is on.
 */
export function findDriveDirectory(
  archive: TakeoutArchive,
  { scope, signalExt }: { scope: string; signalExt: string },
): TakeoutProductDir | null {
  const named = archive.products.find((p) => DRIVE_DIR_NAMES.includes(p.name.toLowerCase()));
  const dir = named ?? directoryWithMost(archive, signalExt);
  if (!dir) {
    logWarn(scope, 'no Drive directory found', {
      products: archive.products.map((p) => p.name),
      looksFor: DRIVE_DIR_NAMES,
      orAnyDirectoryHolding: `.${signalExt}`,
    });
    return null;
  }
  logStep(scope, `using ${dir.name}`, { matchedBy: named ? 'name' : `the .${signalExt} files in it` });
  return dir;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The folders a file sat in inside the export, outermost first. */
export function folderPath(path: string): string[] {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? [] : path.slice(0, slash).split('/');
}

/** Every `.json` in a directory, keyed by lowercased path, for sidecar lookup. */
export function jsonEntriesByPath(dir: TakeoutProductDir): Map<string, TakeoutEntry> {
  const byPath = new Map<string, TakeoutEntry>();
  for (const entry of dir.entries) {
    if (entry.ext === 'json') byPath.set(entry.path.toLowerCase(), entry);
  }
  return byPath;
}

/**
 * Google writes one `<file>-info.json` per exported file when the user asks
 * for metadata. Which name it hangs off — the full filename or the filename
 * without its extension — has varied between exports, so both are accepted.
 */
export function sidecarFor(path: string, byPath: Map<string, TakeoutEntry>): TakeoutEntry | undefined {
  return byPath.get(`${path}-info.json`.toLowerCase()) ?? byPath.get(`${stripExtension(path)}-info.json`.toLowerCase());
}

// ── The metadata sidecar ──────────────────────────────────────────────────────

/** What we read back out of a `-info.json` sidecar. */
export interface DriveFileInfo {
  title?: string;
  description?: string;
  /** When the file was created in Drive, ISO 8601. */
  createdAt?: string;
  /** When it was last modified in Drive, ISO 8601. */
  modifiedAt?: string;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * A date field, under whichever of `keys` the export happened to use.
 *
 * Same leniency as `stringField` and for the same reason — the exact spelling
 * has moved between Takeout versions (`created_date`, `creation_time`,
 * `createdTime`) and an export using a name we don't know about should fall
 * back to the zip entry's date rather than fail. Anything unparseable is
 * dropped by `isoFromText` rather than written onto the file.
 */
function dateField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const iso = isoFromText(record[key]);
    if (iso) return iso;
  }
  return undefined;
}

/**
 * Read a file's `-info.json`, or `null` when there isn't one or it makes no
 * sense.
 *
 * The sidecar matters because a filename is a lossy record of a title: Takeout
 * replaces characters it cannot put in a filename and appends `(1)` to
 * disambiguate, while `title` is what the file was actually called. The exact
 * field names have shifted between Takeout versions, so this reads leniently
 * and every field is optional — a sidecar it cannot make sense of simply
 * leaves the filename in charge.
 */
export async function readDriveInfo(
  entry: TakeoutEntry | undefined,
  scope: string,
): Promise<DriveFileInfo | null> {
  if (!entry) return null;
  try {
    const parsed: unknown = JSON.parse(await entry.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return {
      title: stringField(record, 'title', 'name'),
      description: stringField(record, 'description'),
      createdAt: dateField(record, 'created_date', 'creation_time', 'createdTime', 'created'),
      modifiedAt: dateField(
        record,
        'modified_date',
        'last_modified_date',
        'modification_time',
        'modifiedTime',
        'modified',
      ),
    };
  } catch (err) {
    // Not fatal — the filename is a perfectly good title — but worth a line,
    // since a sidecar format we no longer recognise would show up as every
    // file silently keeping its filename.
    logWarn(scope, `could not read ${entry.path}`, describeError(err));
    return null;
  }
}

/** Tally values by name, for the "what did it see?" log lines. */
export function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
