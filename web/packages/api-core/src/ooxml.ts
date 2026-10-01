/**
 * The Office Open XML formats Neutrino stores documents in (issue #127).
 *
 * Docs, Sheets and Slides were once written as a bespoke JSON body, which
 * meant nothing outside Neutrino could read a Neutrino document. No file was
 * ever stored that way and the format is gone. A native document is a real
 * `.docx`/`.xlsx`/`.pptx` package, so Word, Excel, PowerPoint, LibreOffice and
 * Google's editors all open one directly and import/export are file copies.
 *
 * The mime type is the marker (`src/drive/storage/native_types.rs` mirrors this
 * list on the backend), and the extension rides on the Drive file's *name* so
 * a download lands on disk as something the operating system can open. Titles
 * shown in the UI have it stripped back off — see `stripOoxmlExtension` — so a
 * document is still called "Budget", not "Budget.xlsx".
 */

export const OOXML_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const;

/**
 * The template counterparts of the OOXML formats (issue #128).
 *
 * A template is a document like any other — the same package, read by the
 * same parser — that announces itself as a starting point: its main part's
 * content type says `template.main+xml`, its extension is `.dotx`, and Word
 * opens it as a new untitled document rather than as itself. Neutrino stores
 * one as an ordinary Drive file under this mime type, and that mime type is
 * the whole marker; there is no template table, because the server-side one
 * that existed copied template bodies around in the clear (#132).
 *
 * Only Docs has one so far. `.xltx` and `.potx` follow the same shape and need
 * their editors taught to keep the template content type on save before they
 * can be added here — an entry with no such editor would turn a template into
 * a document on its first autosave.
 */
export const OOXML_TEMPLATE_MIME = {
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
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

const TEMPLATE_EXTENSION: Partial<Record<OoxmlApp, 'dotx'>> = {
  docs: 'dotx',
};

const TEMPLATE_MIME_TO_APP: Record<string, OoxmlApp> = {
  [OOXML_TEMPLATE_MIME.dotx]: 'docs',
};

// A template opens in the same editor as the document it is a template for.
const MIME_TO_APP: Record<string, OoxmlApp> = {
  [OOXML_MIME.docx]: 'docs',
  [OOXML_MIME.xlsx]: 'sheets',
  [OOXML_MIME.pptx]: 'slides',
  ...TEMPLATE_MIME_TO_APP,
};

const EXTENSION_TO_APP: Record<string, OoxmlApp> = {
  docx: 'docs',
  xlsx: 'sheets',
  pptx: 'slides',
  dotx: 'docs',
};

/** The mime type a new document of `app` is created with. */
export function ooxmlMimeFor(app: OoxmlApp): string {
  return APP_MIME[app];
}

/** Which editor owns `mimeType`, or null if it is not an OOXML type. */
export function ooxmlAppForMime(mimeType: string): OoxmlApp | null {
  return MIME_TO_APP[mimeType] ?? null;
}

/** True for a template type — today only `.dotx`. */
export function isOoxmlTemplateMime(mimeType: string): boolean {
  return mimeType in TEMPLATE_MIME_TO_APP;
}

/** The template mime type for `app`, or null when that editor has none yet. */
export function ooxmlTemplateMimeFor(app: OoxmlApp): string | null {
  return app === 'docs' ? OOXML_TEMPLATE_MIME.dotx : null;
}

/** True for the modern OOXML mime types and their templates — never for `.doc`/`.xls`/`.ppt`. */
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
 *
 * `template` asks for the template extension instead — a `.dotx` renamed
 * through the document path would land on disk as a `.docx` holding a package
 * that says it is a template, which Word refuses to open.
 */
export function withOoxmlExtension(
  name: string,
  app: OoxmlApp,
  opts: { template?: boolean } = {},
): string {
  const ext = (opts.template && TEMPLATE_EXTENSION[app]) || OOXML_EXTENSION[app];
  return extensionOf(name) === ext ? name : `${name}.${ext}`;
}

/**
 * `name` without a trailing OOXML extension — the title to show for a file.
 *
 * Only the modern extensions (and `.dotx`) are stripped: a file genuinely called
 * "Q3.report" keeps its name, and so does a legacy `.doc`.
 */
export function stripOoxmlExtension(name: string): string {
  const ext = extensionOf(name);
  if (!ext || !(ext in EXTENSION_TO_APP)) return name;
  return name.slice(0, name.length - ext.length - 1);
}
