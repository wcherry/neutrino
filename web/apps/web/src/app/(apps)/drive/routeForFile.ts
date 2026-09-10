/**
 * Shared mimetype -> route dispatch for Drive file navigation.
 *
 * Extracted from the 3x-duplicated dispatch logic that used to live directly
 * in drive/page.tsx (handleGridItemClick, the starred quick-access onClick,
 * and FileContextMenu.onPreview).
 */

import { officeAppForFile, OOXML_MIME } from '@/lib/officeFormats';

// Docs, Sheets and Slides are OOXML and are routed by `officeAppForFile`
// below, so they have no entry of their own here. The bespoke JSON that
// predated OOXML held no files and is gone.
export const DIAGRAM_MIME = 'application/x-neutrino-diagram';
/**
 * A diagram can also be saved as a plain `.svg`, and an SVG is the one image
 * type Neutrino can *edit* rather than only view — the diagrams canvas is a
 * vector editor and the photo editor is a raster one, which can do nothing with
 * an SVG but show it. So SVG opens in Diagrams, ahead of the `image/` rule
 * below that sends every other picture to Photos.
 *
 * An SVG that was not written here opens as a blank canvas rather than as its
 * own picture: the editor is about to save over the file, and re-deriving
 * shapes from arbitrary markup is guesswork. Import (which does not overwrite
 * anything) is where a foreign SVG becomes something to draw on — see
 * `diagrams/editor/io/svgFormat.ts`.
 */
export const SVG_MIME = 'image/svg+xml';
export const DRAWING_MIME = 'application/x-neutrino-drawing';
/**
 * A note is a Markdown file, and it says so: notes are stored as Markdown and
 * carry the standard MIME type rather than a private one, so a `.md` uploaded
 * to Drive opens in the note editor and a note is readable by anything that
 * reads Markdown — the iOS Notes app included.
 */
export const NOTE_MIME = 'text/markdown';

export interface RoutableFile {
  id: string;
  mimeType: string;
  name: string;
}

export interface RouterLike {
  push: (url: string) => void;
}

export interface RouteForFileOptions {
  onPreviewFallback: (file: RoutableFile) => void;
}

const NATIVE_ROUTE_PREFIX: Record<string, string> = {
  [DIAGRAM_MIME]: '/diagrams/editor?id=',
  [SVG_MIME]: '/diagrams/editor?id=',
  [DRAWING_MIME]: '/drawing/editor?id=',
  [NOTE_MIME]: '/notes/editor?id=',
};

const OFFICE_APP_ROUTE_PREFIX: Record<string, string> = {
  docs: '/docs/editor?id=',
  sheets: '/sheets/editor?id=',
  slides: '/slides/editor?id=',
};

/**
 * Routes a Drive file to the appropriate editor, or falls back to
 * `onPreviewFallback` (the preview modal) when nothing matches.
 *
 * `.docx`/`.xlsx`/`.pptx` route into Docs/Sheets/Slides like anything else the
 * suite owns — since issue #127 that is the format those editors *write*, so a
 * file uploaded from Word and one created here are the same kind of thing.
 * Legacy binary formats (.doc/.xls/.ppt) never match and always fall through.
 */
export function routeForFile(
  file: RoutableFile,
  router: RouterLike,
  opts: RouteForFileOptions
): void {
  const nativePrefix = NATIVE_ROUTE_PREFIX[file.mimeType];
  if (nativePrefix) {
    router.push(`${nativePrefix}${file.id}`);
    return;
  }

  if (file.mimeType.startsWith('image/')) {
    router.push(`/photos/editor?fileId=${file.id}`);
    return;
  }

  const app = officeAppForFile(file.mimeType, file.name);
  if (app) {
    router.push(`${OFFICE_APP_ROUTE_PREFIX[app]}${file.id}`);
    return;
  }

  opts.onPreviewFallback(file);
}

export type PreviewKind = 'doc' | 'sheet' | 'slide' | 'note' | 'diagram' | 'drawing' | 'image';

const NATIVE_PREVIEW_KIND: Record<string, PreviewKind> = {
  [NOTE_MIME]: 'note',
  [DIAGRAM_MIME]: 'diagram',
  [DRAWING_MIME]: 'drawing',
  // `DocumentPreviewModal` reads the model out of the OOXML package (issue #127).
  [OOXML_MIME.docx]: 'doc',
  [OOXML_MIME.xlsx]: 'sheet',
  [OOXML_MIME.pptx]: 'slide',
};

/**
 * The lightweight preview-modal kind for a file's "Preview" context-menu
 * action, or null when there is no dedicated preview renderer and the
 * generic PreviewModal / routeForFile fallback should handle it instead.
 *
 * Deliberately separate from routeForFile: that function is built for
 * click-to-open and unconditionally navigates native Neutrino mimetypes and
 * images into their editor, which made the Drive "Preview" action open the
 * app instead of a preview for Notes/Diagrams/Drawing/Photos (issue #68).
 */
export function previewKindForMime(mimeType: string): PreviewKind | null {
  const kind = NATIVE_PREVIEW_KIND[mimeType];
  if (kind) return kind;
  if (mimeType.startsWith('image/')) return 'image';
  return null;
}

/**
 * The URL a file opens at, for callers that need a link rather than a
 * navigation (search results, sidebar entries). Falls back to `/drive` for
 * files that have no editor and can only be previewed in place.
 *
 * Takes the name as well as the mime type where it has one, because an upload
 * whose browser reported `application/octet-stream` is still a `.docx` — the
 * same fallback `officeAppForFile` makes for the click path.
 */
export function hrefForFile(file: Pick<RoutableFile, 'id' | 'mimeType'> & { name?: string }): string {
  const nativePrefix = NATIVE_ROUTE_PREFIX[file.mimeType];
  if (nativePrefix) return `${nativePrefix}${file.id}`;
  if (file.mimeType.startsWith('image/')) return `/photos/editor?fileId=${file.id}`;
  const app = officeAppForFile(file.mimeType, file.name ?? '');
  if (app) return `${OFFICE_APP_ROUTE_PREFIX[app]}${file.id}`;
  return '/drive';
}
