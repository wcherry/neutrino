/**
 * Shared mimetype -> route dispatch for Drive file navigation (issue #43 —
 * in-place editing of MS Office docs).
 *
 * Extracted from the 3x-duplicated dispatch logic that used to live directly
 * in drive/page.tsx (handleGridItemClick, the starred quick-access onClick,
 * and FileContextMenu.onPreview).
 */

import { officeAppForFile, type OfficeApp } from '@/lib/officeFormats';

export const DOC_MIME = 'application/x-neutrino-doc';
export const SHEET_MIME = 'application/x-neutrino-sheet';
export const SLIDES_MIME = 'application/x-neutrino-slide';
export const DIAGRAM_MIME = 'application/x-neutrino-diagram';
export const DRAWING_MIME = 'application/x-neutrino-drawing';
export const NOTE_MIME = 'application/x-neutrino-note';

export interface RoutableFile {
  id: string;
  mimeType: string;
  name: string;
}

export interface RouterLike {
  push: (url: string) => void;
}

export interface RouteForFileOptions {
  officeInPlaceEditingEnabled: boolean;
  onPreviewFallback: (file: RoutableFile) => void;
}

const NATIVE_ROUTE_PREFIX: Record<string, string> = {
  [DOC_MIME]: '/docs/editor?id=',
  [SHEET_MIME]: '/sheets/editor?id=',
  [SLIDES_MIME]: '/slides/editor?id=',
  [DIAGRAM_MIME]: '/diagrams/editor?id=',
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
 * `onPreviewFallback` (today's preview-modal behavior) when nothing matches.
 *
 * Native Neutrino mimetypes (doc/sheet/slide/diagram/drawing) always route,
 * regardless of the office-in-place-editing flag. Images always route to the
 * photo editor. Raw Office files (.docx/.xlsx/.pptx) only route into their
 * matching editor when `officeInPlaceEditingEnabled` is true; legacy binary
 * formats (.doc/.xls/.ppt) never match and always fall through.
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

  if (opts.officeInPlaceEditingEnabled) {
    const app = officeAppForFile(file.mimeType, file.name);
    if (app) {
      router.push(`${OFFICE_APP_ROUTE_PREFIX[app]}${file.id}`);
      return;
    }
  }

  opts.onPreviewFallback(file);
}

export type PreviewKind = 'doc' | 'sheet' | 'slide' | 'note' | 'diagram' | 'drawing' | 'image';

const NATIVE_PREVIEW_KIND: Record<string, PreviewKind> = {
  [DOC_MIME]: 'doc',
  [SHEET_MIME]: 'sheet',
  [SLIDES_MIME]: 'slide',
  [NOTE_MIME]: 'note',
  [DIAGRAM_MIME]: 'diagram',
  [DRAWING_MIME]: 'drawing',
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
 */
export function hrefForFile(file: Pick<RoutableFile, 'id' | 'mimeType'>): string {
  const nativePrefix = NATIVE_ROUTE_PREFIX[file.mimeType];
  if (nativePrefix) return `${nativePrefix}${file.id}`;
  if (file.mimeType.startsWith('image/')) return `/photos/editor?fileId=${file.id}`;
  return '/drive';
}

/**
 * Builds the editor URL for a raw office file, optionally tagged with a
 * one-shot `promote=1` marker. The editors' office-mode load paths check
 * for this marker (alongside the persisted "convert on open" preference) to
 * trigger an immediate promote — used by the Drive context menu's "Convert
 * to Neutrino X" action, which must promote regardless of the global
 * office-file-mode setting.
 */
export function officeEditorRoute(app: OfficeApp, fileId: string, opts?: { promote?: boolean }): string {
  const url = `${OFFICE_APP_ROUTE_PREFIX[app]}${fileId}`;
  return opts?.promote ? `${url}&promote=1` : url;
}
