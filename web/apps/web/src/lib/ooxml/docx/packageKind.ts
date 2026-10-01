/**
 * Whether a WordprocessingML package is a document or a template (issue #128).
 *
 * A `.docx` and a `.dotx` are the same package with one difference: the
 * content type `[Content_Types].xml` declares for the main part. Every other
 * part — the body, styles, headers, footnotes, the extras part — is identical,
 * which is why `readDocx` reads both without knowing which it has, and why
 * turning one into the other is a rewrite of one attribute rather than a
 * conversion through the editor's model.
 *
 * The attribute is not cosmetic. Word checks it against the file's extension
 * and refuses a `.dotx` whose main part says "document" (and the reverse) as a
 * corrupt file, so a template that kept the document content type would only
 * be a template inside Neutrino.
 */

export type DocxPackageKind = 'document' | 'template';

const MAIN_CONTENT_TYPE: Record<DocxPackageKind, string> = {
  document: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  template: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
};

// Matched by suffix so the rewrite does not depend on how the writer spelled
// the part name or ordered the attributes — Word, LibreOffice and the `docx`
// package all differ.
const MAIN_CONTENT_TYPE_RE =
  /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.(?:document|template)\.main\+xml/;

/** What `pkg` declares itself to be, or null if it has no main part declared. */
export async function readDocxPackageKind(pkg: Uint8Array): Promise<DocxPackageKind | null> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(pkg);
  const xml = await zip.file('[Content_Types].xml')?.async('string');
  const match = xml?.match(MAIN_CONTENT_TYPE_RE)?.[0];
  if (!match) return null;
  return match === MAIN_CONTENT_TYPE.template ? 'template' : 'document';
}

/**
 * `pkg` declaring its main part as `kind`.
 *
 * Returns the input untouched when it already says so, which is the common
 * case on the autosave path — re-zipping a package costs a deflate of every
 * part for nothing.
 */
export async function setDocxPackageKind(
  pkg: Uint8Array,
  kind: DocxPackageKind,
): Promise<Uint8Array> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(pkg);
  const entry = zip.file('[Content_Types].xml');
  if (!entry) throw new Error('not-a-docx');
  const xml = await entry.async('string');
  if (!MAIN_CONTENT_TYPE_RE.test(xml)) throw new Error('not-a-docx');
  const next = xml.replace(MAIN_CONTENT_TYPE_RE, MAIN_CONTENT_TYPE[kind]);
  if (next === xml) return pkg;
  zip.file('[Content_Types].xml', next);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
