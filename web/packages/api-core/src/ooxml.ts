/**
 * The Office Open XML formats Neutrino stores documents in (issue #127).
 *
 * Docs, Sheets and Slides used to be written as bespoke JSON —
 * `application/x-neutrino-doc` and friends — which meant nothing outside
 * Neutrino could read a Neutrino document. A native document is now a real
 * `.docx`/`.xlsx`/`.pptx` package, so Word, Excel, PowerPoint, LibreOffice and
 * Google's editors all open one directly and import/export are file copies.
 *
 * The mime type is the marker (`src/drive/storage/native_types.rs` mirrors this
 * list on the backend), and the extension rides on the Drive file's *name* so
 * a download lands on disk as something the operating system can open. Titles
 * shown in the UI have it stripped back off — see `stripOoxmlExtension` — so a
 * document is still called "Budget", not "Budget.xlsx".
 *
 * The legacy `x-neutrino-*` mime types are still read and written: documents
 * created before this change keep their format, and there is no migration.
 */

export const OOXML_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

/** The three editors that store their documents as OOXML. */
export type OoxmlApp = 'docs' | 'sheets' | 'slides';

export const OOXML_EXTENSION: Record<OoxmlApp, 'docx' | 'xlsx' | 'pptx'> = {
  docs: 'docx',
  sheets: 'xlsx',
  slides: 'pptx',
};

const APP_MIME: Record<OoxmlApp, string> = {
  docs: OOXML_MIME.docx,
  sheets: OOXML_MIME.xlsx,
  slides: OOXML_MIME.pptx,
};

const MIME_TO_APP: Record<string, OoxmlApp> = {
  [OOXML_MIME.docx]: 'docs',
  [OOXML_MIME.xlsx]: 'sheets',
  [OOXML_MIME.pptx]: 'slides',
};

const EXTENSION_TO_APP: Record<string, OoxmlApp> = {
  docx: 'docs',
  xlsx: 'sheets',
  pptx: 'slides',
};

/** The mime type a new document of `app` is created with. */
export function ooxmlMimeFor(app: OoxmlApp): string {
  return APP_MIME[app];
}

/** Which editor owns `mimeType`, or null if it is not an OOXML type. */
export function ooxmlAppForMime(mimeType: string): OoxmlApp | null {
  return MIME_TO_APP[mimeType] ?? null;
}

/** True for the three modern OOXML mime types — never for `.doc`/`.xls`/`.ppt`. */
export function isOoxmlMime(mimeType: string): boolean {
  return mimeType in MIME_TO_APP;
}

function extensionOf(name: string): string | null {
  const idx = name.lastIndexOf('.');
  if (idx === -1 || idx === name.length - 1) return null;
  return name.slice(idx + 1).toLowerCase();
}

/**
 * `name` with the extension for `app` on the end, added only if it is not
 * already there. Renaming "Budget" to "Budget.xlsx" twice must not produce
 * "Budget.xlsx.xlsx".
 */
export function withOoxmlExtension(name: string, app: OoxmlApp): string {
  const ext = OOXML_EXTENSION[app];
  return extensionOf(name) === ext ? name : `${name}.${ext}`;
}

/**
 * `name` without a trailing OOXML extension — the title to show for a file.
 *
 * Only the three modern extensions are stripped: a file genuinely called
 * "Q3.report" keeps its name, and so does a legacy `.doc`.
 */
export function stripOoxmlExtension(name: string): string {
  const ext = extensionOf(name);
  if (!ext || !(ext in EXTENSION_TO_APP)) return name;
  return name.slice(0, name.length - ext.length - 1);
}
