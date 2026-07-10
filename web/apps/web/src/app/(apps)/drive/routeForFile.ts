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
