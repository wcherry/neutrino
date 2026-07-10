/**
 * Modern OOXML (MS Office) format detection helpers (issue #43 — in-place
 * editing of MS Office docs).
 *
 * Scope is intentionally narrow: only the modern, zip-based OOXML formats
 * (.docx/.xlsx/.pptx). Legacy binary formats (.doc/.xls/.ppt) are never
 * matched — those aren't handled by the in-browser conversion libraries
 * (mammoth, xlsx, pptxImport) this feature relies on.
 */

export const OFFICE_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

export type OfficeApp = 'docs' | 'sheets' | 'slides';

const MIME_TO_APP: Record<string, OfficeApp> = {
  [OFFICE_MIME.docx]: 'docs',
  [OFFICE_MIME.xlsx]: 'sheets',
  [OFFICE_MIME.pptx]: 'slides',
};

const EXTENSION_TO_APP: Record<string, OfficeApp> = {
  docx: 'docs',
  xlsx: 'sheets',
  pptx: 'slides',
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
  const byMime = MIME_TO_APP[mimeType];
  if (byMime) return byMime;

  const ext = extensionOf(name);
  if (ext && EXTENSION_TO_APP[ext]) return EXTENSION_TO_APP[ext];

  return null;
}
