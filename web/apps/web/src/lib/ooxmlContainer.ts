/**
 * The OOXML package Neutrino stored a spreadsheet or presentation in
 * (issue #127) — now only a presentation, and only until slides catches up.
 *
 * A native document is a real `.docx`/`.xlsx`/`.pptx`, so it has to survive
 * being opened by Excel, PowerPoint or LibreOffice. But what an editor could
 * *write* used to be a lossy projection of what it could hold, so storing only
 * the OOXML would have meant every autosave silently deleting work.
 *
 * So a package carried both. The OOXML parts are the interoperable copy other
 * tools read; alongside them sat one extra part, `neutrino/model.json`, holding
 * the editor's own full-fidelity model. On open the model won, and nothing was
 * lost across a save in Neutrino; when it was missing the editors fell back to
 * parsing the OOXML, which is how a file from anywhere else opened.
 *
 * **Two of the three apps have left it behind.** `lib/ooxml/docx/` and
 * `lib/ooxml/xlsx/` write and read the whole document as real OOXML, so a
 * `.docx` and an `.xlsx` carry no model part at all; only what OOXML genuinely
 * cannot express rides along, in a `customXml/` part Word and Excel preserve.
 * What is left here is slides, which still packs a model and still reads one,
 * and the *read* side for docs and sheets, because a file saved before its
 * writer landed still has the part and its first save is what migrates it. The
 * same route out is open to slides: each field a writer learns to emit is safe
 * to add, because the model keeps Neutrino correct meanwhile.
 *
 * The fallback is also the answer to a package edited elsewhere. Excel and
 * LibreOffice both discard parts they don't recognise when they save, so a deck
 * round-tripped through them comes back with no model and is parsed from its
 * OOXML — correct, just lossy. A tool that *keeps* the part while rewriting the
 * document would be worse: a stale model would quietly overwrite the outside
 * edit. `digest` closes that off — it fingerprints every other part at save
 * time, and a model whose digest no longer matches the package it sits in is
 * ignored exactly as if it were absent.
 */

import { stripOoxmlExtension, type OoxmlApp } from '@neutrino/api-core';

/** The part holding the editor's own model. Not an OOXML part — see above. */
export const NEUTRINO_MODEL_PART = 'neutrino/model.json';

const CONTENT_TYPES_PART = '[Content_Types].xml';

/**
 * `[Content_Types].xml` must give every extension in the package a content
 * type, or the package is malformed and Word refuses to open it. `.json` is
 * not one OOXML declares, so adding the model part means adding this too.
 */
const JSON_CONTENT_TYPE = '<Default Extension="json" ContentType="application/json"/>';

interface ModelEnvelope {
  version: 1;
  app: OoxmlApp;
  /** Fingerprint of every part of the package except this one. */
  digest: string;
  /** The editor's serialized model — the same string the legacy format stored. */
  model: string;
}

/** A zip's local file header. Cheap way to reject bytes that cannot be a package. */
export function looksLikeOoxml(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

type LoadedZip = Awaited<ReturnType<typeof loadZip>>;

async function loadZip(bytes: Uint8Array) {
  const JSZip = (await import('jszip')).default;
  return JSZip.loadAsync(bytes);
}

/**
 * FNV-1a over every part except the model, name included, in a fixed order.
 *
 * Not a cryptographic hash and not meant to be: the question it answers is
 * "did something rewrite this package behind our back", where the alternative
 * to a cheap answer is no answer at all. Names are hashed alongside contents so
 * an added or removed part registers even when nothing else moved.
 */
async function digestParts(zip: LoadedZip): Promise<string> {
  const names = Object.keys(zip.files)
    .filter((name) => name !== NEUTRINO_MODEL_PART && !zip.files[name].dir)
    .sort();

  let hash = 0xcbf29ce484222325n;
  const mask = 0xffffffffffffffffn;
  const prime = 0x100000001b3n;
  const mix = (byte: number) => {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  };

  const encoder = new TextEncoder();
  for (const name of names) {
    for (const byte of encoder.encode(name)) mix(byte);
    const content = await zip.files[name].async('uint8array');
    for (const byte of content) mix(byte);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * `ooxml` with the editor's `model` stored alongside it, ready to write to
 * Drive.
 *
 * Any model already in `ooxml` is replaced rather than added to, so packing the
 * output of a previous pack is idempotent.
 */
export async function packNeutrinoModel(
  ooxml: Uint8Array,
  app: OoxmlApp,
  model: string,
): Promise<Uint8Array> {
  const zip = await loadZip(ooxml);
  zip.remove(NEUTRINO_MODEL_PART);

  // Declare the extension *before* fingerprinting: the digest has to cover the
  // package as it will be stored, or every read would see a mismatch and throw
  // away the model this just wrote.
  const contentTypes = zip.file(CONTENT_TYPES_PART);
  if (contentTypes) {
    const xml = await contentTypes.async('string');
    if (!/Extension="json"/i.test(xml)) {
      zip.file(CONTENT_TYPES_PART, xml.replace(/(<Types\b[^>]*>)/, `$1${JSON_CONTENT_TYPE}`));
    }
  }

  const envelope: ModelEnvelope = {
    version: 1,
    app,
    digest: await digestParts(zip),
    model,
  };
  zip.file(NEUTRINO_MODEL_PART, JSON.stringify(envelope));

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * The editor model stored in `bytes`, or null when there is none to trust —
 * a package written by another tool, one whose model belongs to a different
 * editor, or one whose parts have changed since the model was written. Every
 * null means the same thing to the caller: parse the OOXML instead.
 */
export async function readNeutrinoModel(
  bytes: Uint8Array,
  app: OoxmlApp,
): Promise<string | null> {
  if (!looksLikeOoxml(bytes)) return null;
  try {
    const zip = await loadZip(bytes);
    const entry = zip.file(NEUTRINO_MODEL_PART);
    if (!entry) return null;

    const envelope = JSON.parse(await entry.async('string')) as ModelEnvelope | null;
    if (!envelope || envelope.version !== 1 || envelope.app !== app) return null;
    if (typeof envelope.model !== 'string') return null;
    if (envelope.digest !== (await digestParts(zip))) return null;

    return envelope.model;
  } catch {
    return null;
  }
}

/**
 * The document title to show for a Drive file the editors opened as OOXML.
 *
 * The file is named `Budget.xlsx` because that is what has to land on disk; the
 * title bar says `Budget`.
 */
export function titleFromFileName(name: string): string {
  return stripOoxmlExtension(name);
}
