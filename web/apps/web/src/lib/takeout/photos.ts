/**
 * Finding Google Photos media inside a Takeout archive.
 *
 * Photos, unlike Docs and Sheets, really is a product directory of its own —
 * one flat level of folders under it, holding the media and a JSON sidecar per
 * file:
 *
 *     Takeout/
 *       Google Photos/
 *         Photos from 2019/
 *           IMG_1234.JPG
 *           IMG_1234.JPG.supplemental-metadata.json
 *         Rome/
 *           metadata.json            ← the album's own title and description
 *           DSC_0001.JPG
 *           DSC_0001.JPG.json
 *         Archive/
 *         Trash/
 *
 * Two things about that layout drive everything here.
 *
 * **A photo in an album appears twice.** Google writes the bytes into the
 * album folder *and* into the year folder it was taken in, so importing the
 * archive file by file would put every album photo in the library twice. They
 * are folded back together by name and size, and the album folders they were
 * found in become the albums the one imported copy belongs to.
 *
 * **A folder is an album unless it is a year.** Album folders carry a
 * `metadata.json` naming them; `Photos from 2019` does not. Where there is no
 * metadata to go on, a folder whose name is nothing but a year is taken for a
 * year folder and everything else for an album. `Archive` and `Trash` are
 * Google's own, and are recognised by name — which is English-only, so a
 * localised export imports its archived photos as an ordinary album called
 * whatever Google named that folder.
 *
 * That is the shape of a *Photos* export. Pictures also reach a Takeout
 * archive a second way — as Drive files, under `Drive/Google Photos/` — with
 * none of the above: no sidecars, no albums, no archive or trash. Those are
 * found too (`nestedPhotosDirs`), because to the person who exported them they
 * are the same pictures.
 */

import type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';
import { countBy, folderPath } from './drive';
import { describeError, logStep, logWarn } from './log';

/** Directory names Google uses for Photos. */
const PHOTOS_DIR_NAMES = ['google photos', 'photos'];

/** Google's own folders, which are not albums. */
const ARCHIVE_FOLDER_NAMES = ['archive'];
const TRASH_FOLDER_NAMES = ['trash', 'bin'];

/** The album's own metadata, written into album folders only. */
const ALBUM_METADATA_NAMES = ['metadata.json', 'album metadata.json'];

/**
 * A folder that is only a year, with or without words around it: `2019`,
 * `Photos from 2019`, `Fotos aus 2019`. Google localises the wording but not
 * the number, so the number is what is matched.
 */
const YEAR_FOLDER = /(?:^|[^\d])(?:19|20)\d{2}(?:[^\d]|$)/;

export type MediaKind = 'image' | 'video';

/**
 * What the browser will call each kind of file when it uploads it. A zip entry
 * carries no content type, and the mime type is what the Photos app reads to
 * decide whether something is a picture or a video.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  dng: 'image/x-adobe-dng',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
};

export interface TakeoutPhoto {
  entry: TakeoutEntry;
  kind: MediaKind;
  /** Content type to upload it as, worked out from the extension. */
  mimeType: string;
  /** The file's name in the export, which is also what it is called in Drive. */
  title: string;
  /** Titles of the albums it appeared in. */
  albums: string[];
  /** Google's metadata sidecar for this file, when the export has one. */
  info?: TakeoutEntry;
  /** It was in Google's Archive rather than in the main library. */
  archived: boolean;
  /** It was in Google's Trash. */
  trashed: boolean;
}

export interface TakeoutAlbum {
  /** Folder name inside the export. */
  folder: string;
  /** Title from `metadata.json`, or the folder name when there is none. */
  title: string;
  /** How many photos are in it. */
  count: number;
}

export interface PhotosSource {
  /** Directory the media came from, for display. */
  directory: string;
  photos: TakeoutPhoto[];
  albums: TakeoutAlbum[];
  /** Copies folded away because the same file was in an album and a year folder. */
  duplicates: number;
}

// ── Reading the files ─────────────────────────────────────────────────────────

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function mediaKind(ext: string): { kind: MediaKind; mimeType: string } | null {
  const mimeType = MIME_BY_EXTENSION[ext];
  if (!mimeType) return null;
  return { kind: mimeType.startsWith('video/') ? 'video' : 'image', mimeType };
}

/**
 * Google's sidecar for one media file, whose name has moved between export
 * versions: `IMG_1234.JPG.json` originally, `IMG_1234.JPG.supplemental-
 * metadata.json` since 2024, and either of those truncated when the whole
 * thing would be too long for the filesystem. A duplicate is numbered on the
 * *sidecar* rather than on the media file, so `IMG_1234(1).JPG` is described
 * by `IMG_1234.JPG(1).json`.
 *
 * Exact names are tried first and a prefix match last, since a prefix match
 * can only be as good as the file's name being unique in its folder.
 */
function sidecarFor(path: string, jsonByPath: Map<string, TakeoutEntry>): TakeoutEntry | undefined {
  const lower = path.toLowerCase();
  const exact = jsonByPath.get(`${lower}.json`) ?? jsonByPath.get(`${lower}.supplemental-metadata.json`);
  if (exact) return exact;

  // `name(1).jpg` → `name.jpg(1).json`
  const numbered = lower.match(/^(.*)\((\d+)\)(\.[^./]+)$/);
  if (numbered) {
    const swapped = jsonByPath.get(`${numbered[1]}${numbered[3]}(${numbered[2]}).json`);
    if (swapped) return swapped;
  }

  for (const [candidate, entry] of jsonByPath) {
    if (candidate.startsWith(`${lower}.`)) return entry;
  }
  // A truncated sidecar keeps as much of the name as fits, so the last resort
  // is the reverse: a sidecar name that the media file's name starts with.
  for (const [candidate, entry] of jsonByPath) {
    const stem = candidate.replace(/(?:\.supplemental-metadata)?\.json$/, '');
    if (stem.length >= 8 && lower.startsWith(stem)) return entry;
  }
  return undefined;
}

/** The one folder each entry sits in, or `''` for the directory itself. */
function folderOf(path: string): string {
  return folderPath(path)[0] ?? '';
}

// ── Albums ────────────────────────────────────────────────────────────────────

interface FolderKind {
  /** The album this folder is, or `null` when it is not one. */
  album: string | null;
  archived: boolean;
  trashed: boolean;
}

async function readAlbumTitle(entry: TakeoutEntry | undefined): Promise<string | null> {
  if (!entry) return null;
  try {
    const parsed: unknown = JSON.parse(await entry.text());
    if (!parsed || typeof parsed !== 'object') return null;
    const title = (parsed as { title?: unknown }).title;
    return typeof title === 'string' && title.trim() ? title.trim() : null;
  } catch (err) {
    logWarn('photos', `could not read ${entry.path}`, describeError(err));
    return null;
  }
}

/**
 * What each folder in the export is. Album titles come from the folder's own
 * `metadata.json` where there is one, because Google rewrites a title it
 * cannot put in a folder name — a slash becomes a hyphen, and an album called
 * `2019` would otherwise be indistinguishable from a year.
 */
async function classifyFolders(dir: TakeoutProductDir): Promise<Map<string, FolderKind>> {
  const metadataByFolder = new Map<string, TakeoutEntry>();
  const folders = new Set<string>();
  for (const entry of dir.entries) {
    const folder = folderOf(entry.path);
    folders.add(folder);
    if (ALBUM_METADATA_NAMES.includes(baseName(entry.path).toLowerCase())) {
      metadataByFolder.set(folder, entry);
    }
  }

  const kinds = new Map<string, FolderKind>();
  for (const folder of folders) {
    const lower = folder.toLowerCase();
    if (folder === '') {
      // Media loose in the directory belongs to no album.
      kinds.set(folder, { album: null, archived: false, trashed: false });
      continue;
    }
    if (ARCHIVE_FOLDER_NAMES.includes(lower)) {
      kinds.set(folder, { album: null, archived: true, trashed: false });
      continue;
    }
    if (TRASH_FOLDER_NAMES.includes(lower)) {
      kinds.set(folder, { album: null, archived: false, trashed: true });
      continue;
    }
    const titled = await readAlbumTitle(metadataByFolder.get(folder));
    // No metadata and nothing but a year in the name: a year folder, which is
    // the library itself rather than an album.
    const album = titled ?? (YEAR_FOLDER.test(folder) ? null : folder);
    kinds.set(folder, { album, archived: false, trashed: false });
  }
  return kinds;
}

// ── Collecting ────────────────────────────────────────────────────────────────

/**
 * The same photo in two folders is one photo. Name and size identify it:
 * Google writes the identical bytes into the album folder and the year folder,
 * so the pair match exactly, while two genuinely different photos would have
 * to collide on both to be confused — and if they did, the loss is one copy of
 * a file that is byte-identical to the one that was kept.
 */
function identityOf(entry: TakeoutEntry): string {
  return `${baseName(entry.path).toLowerCase()}:${entry.size}`;
}

async function collect(dir: TakeoutProductDir): Promise<PhotosSource> {
  const jsonByPath = new Map<string, TakeoutEntry>();
  for (const entry of dir.entries) {
    if (entry.ext === 'json') jsonByPath.set(entry.path.toLowerCase(), entry);
  }
  const folderKinds = await classifyFolders(dir);

  const byIdentity = new Map<string, TakeoutPhoto>();
  const albumCounts = new Map<string, TakeoutAlbum>();
  /** Extensions that were not media we recognise. */
  const ignored = new Map<string, number>();
  let duplicates = 0;

  for (const entry of dir.entries) {
    const media = mediaKind(entry.ext);
    if (!media) {
      if (entry.ext !== 'json') {
        ignored.set(entry.ext || '(no extension)', (ignored.get(entry.ext || '(no extension)') ?? 0) + 1);
      }
      continue;
    }

    const folder = folderOf(entry.path);
    const kind = folderKinds.get(folder) ?? { album: null, archived: false, trashed: false };
    if (kind.album) {
      const existing = albumCounts.get(kind.album);
      if (existing) existing.count++;
      else albumCounts.set(kind.album, { folder, title: kind.album, count: 1 });
    }

    const identity = identityOf(entry);
    const seen = byIdentity.get(identity);
    if (seen) {
      duplicates++;
      // The copies differ only in where they sit, so what the second one adds
      // is its folder: another album, or the fact that Google had it archived.
      if (kind.album && !seen.albums.includes(kind.album)) seen.albums.push(kind.album);
      seen.archived = seen.archived || kind.archived;
      // Trashed only stands if *every* copy was in the trash — a photo also
      // filed in an album was not deleted.
      seen.trashed = seen.trashed && kind.trashed;
      // A year folder's copy is the one with the sidecar more often than an
      // album's, so take whichever copy has one.
      if (!seen.info) seen.info = sidecarFor(entry.path, jsonByPath);
      continue;
    }

    byIdentity.set(identity, {
      entry,
      kind: media.kind,
      mimeType: media.mimeType,
      title: baseName(entry.path),
      albums: kind.album ? [kind.album] : [],
      info: sidecarFor(entry.path, jsonByPath),
      archived: kind.archived,
      trashed: kind.trashed,
    });
  }

  const photos = [...byIdentity.values()];
  logStep('photos', `scanned ${dir.name}`, {
    entries: dir.entries.length,
    media: photos.length,
    byKind: countBy(photos.map((p) => p.kind)),
    withSidecar: photos.filter((p) => p.info).length,
    albums: albumCounts.size,
    archived: photos.filter((p) => p.archived).length,
    trashed: photos.filter((p) => p.trashed).length,
    duplicatesFolded: duplicates,
    ignored: Object.fromEntries(ignored),
  });

  return {
    directory: dir.name,
    photos,
    // Counted off the deduplicated photos rather than off the folders, so an
    // album's count is what the import would actually put in it.
    albums: [...albumCounts.values()].map((album) => ({
      ...album,
      count: photos.filter((p) => p.albums.includes(album.title)).length,
    })),
    duplicates,
  };
}

// ── Locating the directory ────────────────────────────────────────────────────

/**
 * How much a directory looks like a Photos export: media files that have a
 * JSON sidecar of their own.
 *
 * Media alone is not enough to go on. Keep exports the images attached to
 * notes, and a Drive export is mostly photos in the ordinary sense — offering
 * either of those to the Photos importer would be wrong. The sidecar beside
 * each file is what only Photos writes.
 */
function sidecarScore(dir: TakeoutProductDir): number {
  const jsonNames = new Set<string>();
  for (const entry of dir.entries) {
    if (entry.ext === 'json') jsonNames.add(entry.path.toLowerCase());
  }
  if (jsonNames.size === 0) return 0;

  let score = 0;
  for (const entry of dir.entries) {
    if (!MIME_BY_EXTENSION[entry.ext]) continue;
    const lower = entry.path.toLowerCase();
    if (jsonNames.has(`${lower}.json`) || jsonNames.has(`${lower}.supplemental-metadata.json`)) score++;
  }
  return score;
}

/**
 * A `Google Photos` folder sitting *inside* another product, re-rooted so the
 * rest of this module can treat it as the directory it scans.
 *
 * This is what an export looks like when the pictures reached Drive rather
 * than Photos — the old Drive/Photos integration wrote them there, and a
 * folder someone simply named `Google Photos` lands the same way:
 *
 *     Takeout/
 *       Drive/
 *         Google Photos/
 *           IMG_20181105_141610.jpg
 *
 * They are Drive files, so there are **no sidecars** beside them — no album
 * metadata, no `photoTakenTime`. Everything the import needs beyond the bytes
 * comes out of the file's own EXIF on the server, which is where the capture
 * date for these comes from.
 */
function nestedPhotosDirs(product: TakeoutProductDir): TakeoutProductDir[] {
  const byFolder = new Map<string, TakeoutEntry[]>();
  for (const entry of product.entries) {
    const slash = entry.path.indexOf('/');
    if (slash <= 0) continue;
    const top = entry.path.slice(0, slash);
    if (!PHOTOS_DIR_NAMES.includes(top.toLowerCase())) continue;
    // Only `path` changes; `text`/`blob` close over the zip entry, so copying
    // them keeps reading the right bytes.
    const rerooted: TakeoutEntry = { ...entry, path: entry.path.slice(slash + 1) };
    const existing = byFolder.get(top);
    if (existing) existing.push(rerooted);
    else byFolder.set(top, [rerooted]);
  }
  return [...byFolder.entries()].map(([folder, entries]) => ({
    name: `${product.name}/${folder}`,
    entries,
  }));
}

/**
 * Where the media might be, best first.
 *
 * A directory named for Photos is taken at its word — the name is the signal,
 * so media in it needs no sidecar to qualify. The sidecar score is the last
 * resort, for an export whose directory names Google localised, and there the
 * sidecars are the only thing separating a Photos export from Keep's
 * attachments or a Drive full of pictures.
 */
function photoDirCandidates(archive: TakeoutArchive): Array<{ dir: TakeoutProductDir; matchedBy: string }> {
  const candidates: Array<{ dir: TakeoutProductDir; matchedBy: string }> = [];

  const named = archive.products.find((p) => PHOTOS_DIR_NAMES.includes(p.name.toLowerCase()));
  if (named) candidates.push({ dir: named, matchedBy: 'name' });

  for (const product of archive.products) {
    if (product === named) continue;
    for (const nested of nestedPhotosDirs(product)) {
      candidates.push({ dir: nested, matchedBy: `a folder named for Photos inside ${product.name}` });
    }
  }

  let best = 0;
  let bestDir: TakeoutProductDir | null = null;
  for (const product of archive.products) {
    const score = sidecarScore(product);
    if (score > best) {
      best = score;
      bestDir = product;
    }
  }
  if (bestDir && bestDir !== named) {
    candidates.push({ dir: bestDir, matchedBy: `${best} media files with sidecars` });
  }

  return candidates;
}

/** Locate the Google Photos media in an archive, or `null` when it holds none. */
export async function findTakeoutPhotos(archive: TakeoutArchive): Promise<PhotosSource | null> {
  const candidates = photoDirCandidates(archive);

  for (const { dir, matchedBy } of candidates) {
    const source = await collect(dir);
    if (source.photos.length > 0) {
      logStep('photos', `using ${dir.name}`, { matchedBy });
      return source;
    }
    logWarn('photos', `${dir.name} holds no photos or videos`, { matchedBy });
  }

  logWarn('photos', 'no Google Photos media found', {
    products: archive.products.map((p) => p.name),
    looksFor: PHOTOS_DIR_NAMES,
    eitherAsAProductDirectoryOrNestedInOne: true,
    orAnyDirectoryHolding: 'media files with .json sidecars',
    considered: candidates.map((c) => c.dir.name),
  });
  return null;
}

// ── The metadata sidecar ──────────────────────────────────────────────────────

export interface PhotoInfo {
  /** What the photo was called in Google Photos. */
  title?: string;
  description?: string;
  /**
   * When the photo was taken, as `YYYY-MM-DDTHH:MM:SS` in UTC — the one shape
   * the register endpoint parses (see `captureDateOf`).
   */
  takenAt?: string;
  /** The user had starred it. */
  favorite?: boolean;
}

/**
 * A Takeout timestamp — seconds since the epoch, as a string — in the format
 * `POST /api/v1/photos` parses.
 *
 * The endpoint reads `%Y-%m-%dT%H:%M:%S` and nothing else, so the `Z` and the
 * milliseconds that `toISOString` adds would make it drop the date silently
 * and leave the photo with no capture date at all — undated in a library
 * sorted by date, which is most of what Photos is for.
 */
export function captureDateOf(timestampSeconds: string | number | undefined): string | undefined {
  if (timestampSeconds === undefined || timestampSeconds === null) return undefined;
  const seconds = typeof timestampSeconds === 'number' ? timestampSeconds : Number(timestampSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 19);
}

function timestampField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (!value || typeof value !== 'object') return undefined;
  return captureDateOf((value as { timestamp?: string | number }).timestamp);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Read a photo's sidecar, or `null` when there isn't one or it makes no sense.
 *
 * Everything in it is optional. A photo whose sidecar cannot be read still
 * imports — it keeps its filename and arrives without a capture date, which
 * the server may still work out from the EXIF in the file itself, since the
 * original bytes are what gets uploaded.
 */
export async function readPhotoInfo(entry: TakeoutEntry | undefined): Promise<PhotoInfo | null> {
  if (!entry) return null;
  try {
    const parsed: unknown = JSON.parse(await entry.text());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return {
      title: stringField(record, 'title'),
      description: stringField(record, 'description'),
      // `photoTakenTime` is when the shutter went; `creationTime` is when it
      // reached Google, which for anything uploaded later is the wrong date.
      takenAt: timestampField(record, 'photoTakenTime') ?? timestampField(record, 'creationTime'),
      favorite: record.favorited === true,
    };
  } catch (err) {
    logWarn('photos', `could not read ${entry.path}`, describeError(err));
    return null;
  }
}
