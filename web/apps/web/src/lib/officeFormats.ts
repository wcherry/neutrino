/**
 * OOXML format detection for Drive files.
 *
 * The mime types and the name/extension helpers live in `@neutrino/api-core`
 * (`ooxml.ts`) because the api-* packages need them too — a document is created
 * with one of these mime types now, so they are part of the wire contract, not
 * a UI detail. This module is the app-side view of them: which editor opens a
 * given file.
 *
 * Scope is intentionally narrow: only the modern, zip-based OOXML formats
 * (.docx/.xlsx/.pptx). Legacy binary formats (.doc/.xls/.ppt) are never
 * matched — those aren't handled by the in-browser conversion libraries
 * (mammoth, xlsx, pptxImport) the editors read them with.
 */

import {
  OOXML_MIME,
  OOXML_EXTENSION,
  ooxmlAppForMime,
  isOoxmlTemplateMime as isOoxmlTemplateMimeImpl,
  type OoxmlApp,
} from '@neutrino/api-core';

export {
  OOXML_MIME,
  OOXML_EXTENSION,
  OOXML_TEMPLATE_MIME,
  ooxmlMimeFor,
  ooxmlTemplateMimeFor,
  ooxmlAppForMime,
  isOoxmlMime,
  isOoxmlTemplateMime,
  withOoxmlExtension,
  stripOoxmlExtension,
} from '@neutrino/api-core';

/** Kept as the app's own spelling of the same three mime types. */
export const OFFICE_MIME = OOXML_MIME;

export type OfficeApp = OoxmlApp;

const EXTENSION_TO_APP: Record<string, OfficeApp> = {
  [OOXML_EXTENSION.docs]: 'docs',
  [OOXML_EXTENSION.sheets]: 'sheets',
  [OOXML_EXTENSION.slides]: 'slides',
  // A Word template opens in Docs like the document it is a template for.
  dotx: 'docs',
};

function extensionOf(name: string): string | null {
  const idx = name.lastIndexOf('.');
  if (idx === -1 || idx === name.length - 1) return null;
  return name.slice(idx + 1).toLowerCase();
}

/**
 * Determine which editor app (if any) should open a file, based first on its
 * mimetype and, when that's a generic/empty value (browsers sometimes report
 * `application/octet-stream` for these formats — see UploadZone.tsx:63),
 * falling back to the filename extension.
 *
 * Never matches legacy binary Office formats (.doc/.xls/.ppt), even via the
 * extension fallback.
 */
export function officeAppForFile(mimeType: string, name: string): OfficeApp | null {
  const byMime = ooxmlAppForMime(mimeType);
  if (byMime) return byMime;

  const ext = extensionOf(name);
  if (ext && EXTENSION_TO_APP[ext]) return EXTENSION_TO_APP[ext];

  return null;
}

/**
 * Whether a file is a Word template (issue #128) — by mime type, or by its
 * `.dotx` name when the upload arrived as `application/octet-stream`.
 *
 * The editor asks this rather than checking the mime type alone, because it
 * decides what every save writes: a `.dotx` that `officeAppForFile` opened by
 * its extension, saved as a document, would be a file Word refuses to open.
 */
export function isTemplateFile(mimeType: string, name: string): boolean {
  return isOoxmlTemplateMimeImpl(mimeType) || extensionOf(name) === 'dotx';
}
