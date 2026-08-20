/**
 * Giving an imported file the dates it actually had.
 *
 * Every runner used to leave its files stamped with the moment the import ran
 * (issue #110). A library brought across in one afternoon then sorted as
 * though every file in it was written that afternoon, and the photos timeline
 * — which is nothing but a sort by date — was the same afternoon end to end.
 *
 * The dates are in the export. What differs per product is where, and in what
 * shape, which is what this module normalises:
 *
 *   Drive     `-info.json` sidecar, ISO strings under keys that have moved
 *             between Takeout versions (`drive.ts` reads them)
 *   Keep      `createdTimestampUsec` / `userEditedTimestampUsec`, microseconds
 *   Photos    the sidecar's `photoTakenTime.timestamp`, seconds as a string
 *   anything  the zip entry's own last-modified date
 *
 * The last one is the fallback for all of them, and the only source for the
 * pictures that reached Drive rather than Photos — those have no sidecar at
 * all (see `nestedPhotosDirs` in `photos.ts`).
 *
 * The dates are written in a second call, after the file's content, because
 * writing content is what stamps `updatedAt` with the current time: anything
 * set at creation would not survive its own body being saved.
 */

import { storageApi } from '@/lib/api';
import { describeError, logWarn } from './log';
import type { TakeoutEntry } from './archive';

/**
 * The two dates a file carries, as ISO 8601 strings. Either may be absent —
 * an export that records one and not the other leaves the other alone rather
 * than having it invented.
 */
export interface ImportedFileDates {
  createdAt?: string;
  updatedAt?: string;
}

// ── Reading a date out of whatever the export wrote ───────────────────────────

/** Only dates in this range are believable; see `isoFrom`. */
const EARLIEST_YEAR = 1981;

/**
 * An ISO string for a date worth writing, or `undefined`.
 *
 * The bounds matter more than they look. A zero DOS timestamp reads back as
 * 1980, `new Date(0)` is 1970, and a microsecond value read as seconds lands
 * tens of thousands of years out — each of which would be written onto the
 * file as confidently as a real date, and none of which is recoverable
 * afterwards. Dropping them leaves the file at the import date, which is
 * merely the old behaviour rather than a new wrong answer.
 */
function isoFrom(date: Date): string | undefined {
  const time = date.getTime();
  if (!Number.isFinite(time)) return undefined;
  const year = date.getUTCFullYear();
  if (year < EARLIEST_YEAR || year > new Date().getUTCFullYear() + 1) return undefined;
  return date.toISOString();
}

/** A `Date` — a zip entry's, say — as an ISO string. */
export function isoFromDate(value: Date | null | undefined): string | undefined {
  return value instanceof Date ? isoFrom(value) : undefined;
}

/**
 * An epoch timestamp as an ISO string, in the unit the product wrote it in.
 *
 * The unit is a parameter rather than something this guesses from magnitude:
 * Keep writes microseconds and Photos writes seconds, both of them sometimes
 * as strings, and a wrong guess is a file confidently dated to the year
 * 56,000 rather than an obvious failure.
 */
export function isoFromEpoch(
  value: unknown,
  unit: 'seconds' | 'milliseconds' | 'microseconds',
): string | undefined {
  const raw = typeof value === 'string' ? Number(value) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  const perMillisecond = { seconds: 1 / 1000, milliseconds: 1, microseconds: 1000 }[unit];
  return isoFrom(new Date(raw / perMillisecond));
}

/** A date string an export wrote — ISO, with or without a zone — as an ISO string. */
export function isoFromText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : isoFrom(parsed);
}

// ── Choosing which dates to write ─────────────────────────────────────────────

/**
 * The dates from the export's own metadata, falling back to the zip entry.
 *
 * The fallback fills *both* dates from the entry's single modified date, and
 * deliberately so: filling only `updatedAt` would leave `createdAt` at the
 * import's clock, which is half of the bug still in place. A file's mtime is a
 * far better guess at when it was created than this afternoon is.
 */
export function datesFor(entry: TakeoutEntry, fromMetadata: ImportedFileDates): ImportedFileDates {
  const fallback = isoFromDate(entry.lastModified);
  const createdAt = fromMetadata.createdAt ?? fallback;
  const updatedAt = fromMetadata.updatedAt ?? fallback;
  return {
    ...(createdAt ? { createdAt } : {}),
    // A file cannot have been modified before it was written. Takeout can
    // produce that pair — a sidecar `created_date` beside a zip entry dated
    // when the export was built — and it renders as a negative age.
    ...(updatedAt ? { updatedAt: createdAt && updatedAt < createdAt ? createdAt : updatedAt } : {}),
  };
}

// ── Writing them ──────────────────────────────────────────────────────────────

export interface ApplyImportMetadataArgs {
  /** The Drive file just written. */
  fileId: string;
  /** Which log the failure belongs in — `docs`, `keep`, `photos`, `sheets`. */
  scope: string;
  /** The file's path inside the archive, recorded on the row as its provenance. */
  source: string;
  dates: ImportedFileDates;
}

/**
 * Record a file's real dates and where it came from.
 *
 * Never throws. An import is a long unattended run, and a file that arrived
 * with its content intact is imported whether or not its dates could be
 * stamped afterwards — failing the item here would report a successful upload
 * as a failure and invite the user to run the whole thing again. The failure
 * goes to the console like every other thing this module cannot fix.
 */
export async function applyImportMetadata({
  fileId,
  scope,
  source,
  dates,
}: ApplyImportMetadataArgs): Promise<void> {
  try {
    await storageApi.setImportMetadata(fileId, { importSource: source, ...dates });
  } catch (err) {
    logWarn(scope, `could not date ${source}`, {
      fileId,
      ...dates,
      error: describeError(err),
      consequence: 'the file keeps the date of the import',
    });
  }
}

/**
 * A `YYYY-MM-DDTHH:MM:SS` capture date for `POST /api/v1/photos`.
 *
 * That endpoint parses one format and silently drops anything else (see
 * `captureDateOf` in `photos.ts`), so the `Z` and the milliseconds that
 * `toISOString` produces have to come off. Used for the photos whose date came
 * from the zip rather than from a sidecar.
 */
export function captureDateFromIso(iso: string | undefined): string | undefined {
  return iso ? iso.slice(0, 19) : undefined;
}
