/**
 * Finding Google Slides presentations inside a Takeout archive.
 *
 * A Google Slides deck is a Drive file, exactly as a Doc and a Sheet are, so it
 * comes out under `Takeout/Drive/` in the folder tree the user had rather than
 * in a product directory of its own; `drive.ts` describes that layout and
 * locates the directory, and this is the third finder reading it.
 *
 * One format can be read here: `.pptx`, the Takeout default, which is also what
 * a presentation *is* in Neutrino — so the import is a copy rather than a
 * conversion (`importSlides.ts`). `.odp` and the ancient `.ppt` are decks we
 * cannot open in the browser, so they are counted and reported rather than
 * silently missing, the same courtesy the docs and sheets finders extend to
 * `.odt` and `.ods`.
 *
 * Two presentation formats Takeout can produce are deliberately *not* reported
 * here. `.pdf` and `.txt` say nothing about which app wrote them — a PDF in
 * Drive is as likely to be an exported Doc as an exported deck — and the docs
 * finder already claims both, so reporting them again would tell the user twice
 * about one file and disagree with itself about what it was.
 */

import type { TakeoutArchive, TakeoutEntry, TakeoutProductDir } from './archive';
import {
  baseName,
  countBy,
  findDriveDirectory,
  folderPath,
  jsonEntriesByPath,
  readDriveInfo,
  sidecarFor,
  stripExtension,
  type DriveFileInfo,
} from './drive';
import { logStep, logWarn } from './log';

/** What a presentation's `-info.json` holds; the same shape for every Drive file. */
export type DriveSlideInfo = DriveFileInfo;

/** How a presentation's bytes have to be read to get at its slides. */
export type SlideFormat = 'pptx';

const FORMAT_BY_EXTENSION: Record<string, SlideFormat> = {
  pptx: 'pptx',
  // Macro-enabled decks are the same package with a different content type;
  // the macros are not run here any more than Excel's are in `.xlsm`.
  pptm: 'pptx',
};

/**
 * Presentation formats Takeout can produce that cannot be read here, mapped to
 * what to call them when reporting.
 */
const UNCONVERTIBLE_BY_EXTENSION: Record<string, string> = {
  odp: 'OpenDocument presentation',
  ppt: 'PowerPoint 97–2003',
};

export interface DriveSlideEntry {
  entry: TakeoutEntry;
  format: SlideFormat;
  /** Title taken from the filename; `readSlideInfo` may have a better one. */
  title: string;
  /** The folders this file sat in inside the export, outermost first. */
  path: string[];
  /** Google's metadata sidecar for this file, when the export includes them. */
  info?: TakeoutEntry;
}

export interface UnsupportedSlide {
  /** Path inside the Drive directory. */
  path: string;
  /** Human-readable format name, e.g. `OpenDocument presentation`. */
  format: string;
}

export interface DriveSlidesSource {
  /** Directory the presentations came from, for display. */
  directory: string;
  slides: DriveSlideEntry[];
  unsupported: UnsupportedSlide[];
}

// ── Locating the presentations ────────────────────────────────────────────────

function collect(dir: TakeoutProductDir): DriveSlidesSource {
  const jsonByPath = jsonEntriesByPath(dir);

  const slides: DriveSlideEntry[] = [];
  const unsupported: UnsupportedSlide[] = [];
  /** Extensions that were neither a deck nor a format we report on. */
  const ignored = new Map<string, number>();

  for (const entry of dir.entries) {
    const format = FORMAT_BY_EXTENSION[entry.ext];
    if (format) {
      slides.push({
        entry,
        format,
        title: stripExtension(baseName(entry.path)),
        path: folderPath(entry.path),
        info: sidecarFor(entry.path, jsonByPath),
      });
      continue;
    }
    const unconvertible = UNCONVERTIBLE_BY_EXTENSION[entry.ext];
    if (unconvertible) unsupported.push({ path: entry.path, format: unconvertible });
    else ignored.set(entry.ext || '(no extension)', (ignored.get(entry.ext || '(no extension)') ?? 0) + 1);
  }

  // As in the other two finders, the ignored tally is the answer to "why didn't
  // it find my presentations?" — it names the extensions that were passed over,
  // which is what an export made in the wrong format looks like from here.
  logStep('slides', `scanned ${dir.name}`, {
    entries: dir.entries.length,
    presentations: slides.length,
    byFormat: countBy(slides.map((s) => s.format)),
    withSidecar: slides.filter((s) => s.info).length,
    unsupported: countBy(unsupported.map((u) => u.format)),
    ignored: Object.fromEntries(ignored),
  });

  return { directory: dir.name, slides, unsupported };
}

/** Locate the presentations in an archive, or `null` when it holds none. */
export function findDriveSlides(archive: TakeoutArchive): DriveSlidesSource | null {
  // `.pptx` is the signal for a Drive directory Google localised the name of,
  // and is as safe a signal as `.docx` and `.xlsx`: no other Takeout product
  // writes one.
  const dir = findDriveDirectory(archive, { scope: 'slides', signalExt: 'pptx' });
  if (!dir) return null;

  const source = collect(dir);
  // A Drive directory of nothing but documents and spreadsheets is not a Slides
  // export, and saying so is the page's "no presentations found" case.
  if (source.slides.length === 0 && source.unsupported.length === 0) {
    logWarn('slides', `${dir.name} holds no presentations in any format`);
    return null;
  }
  return source;
}

// ── The metadata sidecar ──────────────────────────────────────────────────────

/** Read a presentation's `-info.json`. See `readDriveInfo`. */
export function readSlideInfo(entry: TakeoutEntry | undefined): Promise<DriveFileInfo | null> {
  return readDriveInfo(entry, 'slides');
}
