/**
 * Reading an OpenRaster package.
 *
 * Redesign phase 3. Two files can arrive here and they are handled differently
 * on purpose:
 *
 * **A package this app wrote** carries the whole document in
 * `META-INF/neutrino/document.json`, so the round trip is lossless — vector
 * layers come back as vectors, text as text, masks as masks, guides and grid
 * intact — and `stack.xml` is not consulted at all. The manifest is trusted
 * only after `parseDocument` has validated it, which is the same defensive
 * parse a stored body goes through, because a `.ora` is a file from outside and
 * `META-INF/neutrino/document.json` is a name anybody can write.
 *
 * **A package from Krita, GIMP or anything else** is read from `stack.xml`:
 * every `<layer>` becomes a raster layer holding that entry's PNG, every
 * `<stack>` becomes a group, and the attributes the baseline defines — opacity,
 * visibility, `composite-op`, `isolation`, plus the `edit-locked` and
 * `selected` extensions — come across. Anything else is ignored rather than
 * guessed at.
 *
 * The two paths meet at the same `DrawingDocument`, so nothing downstream knows
 * which kind of file it came from.
 */

import { parseDocument } from '../../document/serialize';
import { createDocument, createRasterLayer, createStack } from '../../document/factory';
import { normalizeTree, refreshBounds, symbolTable } from '../../document/tree';
import { iccDataUrl, parseIccProfile } from '../icc';
import { pngBitDepth } from '../png/chunks';
import { ICC_PATH, MANIFEST_PATH } from './manifest';
import { ORA_MIME_TYPE } from './writeOra';
import { parseStackXml, type ParsedNode, type ParsedStack } from './parseStackXml';
import type { DrawingDocument, DrawingNode, RasterSource, StackNode } from '../../document/types';

export interface OraReadResult {
  document: DrawingDocument;
  /**
   * The layer the file marks with the `selected` extension, if any — what the
   * editor makes active on open, so reopening a drawing lands on the layer it
   * was left on.
   */
  selectedNodeId: string | null;
  /**
   * Whether the Neutrino manifest was used. False means the document was
   * rebuilt from `stack.xml` alone and every layer is raster, which is what the
   * import UI says out loud rather than letting someone discover it by trying
   * to edit their text.
   */
  fromManifest: boolean;
}

export class OraReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OraReadError';
  }
}

/**
 * The slice of JSZip this module uses.
 *
 * Declared structurally rather than as `import('jszip')` because the library is
 * loaded dynamically — it is a large dependency and an editor session that
 * never opens an `.ora` should not carry it — and naming three methods is
 * clearer about what an archive has to provide than a type import that pulls in
 * the whole surface.
 */
interface ZipArchive {
  file(path: string): {
    async(type: 'string'): Promise<string>;
    async(type: 'base64'): Promise<string>;
    async(type: 'uint8array'): Promise<Uint8Array>;
  } | null;
}

/** Everything an `.ora` can hold as a layer asset. PNG is the only one required. */
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

function mimeForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_MIME[extension] ?? 'image/png';
}

// ---------------------------------------------------------------------------
// Image dimensions
// ---------------------------------------------------------------------------

/**
 * A PNG's pixel size, read out of its IHDR chunk.
 *
 * Straight from the bytes rather than by decoding the image, for two reasons.
 * A layer's size is needed to build the document, and decoding every layer of a
 * large package to learn its width would cost several seconds and a lot of
 * memory before anything appeared on screen. And `Image` does not exist in
 * jsdom, so a reader that depended on it could not be tested at all.
 *
 * The IHDR is fixed at the head of every PNG: an 8-byte signature, a 4-byte
 * chunk length, the 4-byte type `IHDR`, then width and height as big-endian
 * 32-bit integers.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return null;
  }
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * A JPEG's pixel size, from the first start-of-frame marker.
 *
 * OpenRaster's data requirements name PNG, but files carrying JPEG layers
 * exist and a reader that sized them 1×1 would stretch one pixel across the
 * layer. Walking the marker chain is a dozen lines and covers the case.
 */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // SOF0–SOF15, excluding the four that are not frame headers (DHT, JPG,
    // DAC, and the restart markers), all carry height then width at the same
    // place.
    const isFrame = marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (isFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length <= 0) return null;
    offset += 2 + length;
  }
  return null;
}

function imageSize(bytes: Uint8Array, path: string): { width: number; height: number } | null {
  return mimeForPath(path) === 'image/jpeg' ? jpegSize(bytes) : pngSize(bytes);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface ArchiveEntry {
  base64: string;
  bytes: Uint8Array;
}

/**
 * Opens the package and builds a document from it.
 *
 * Throws `OraReadError` with a sentence fit to show a user rather than
 * returning null, because every failure here has a different cause and a single
 * "could not open" would leave someone with a file and no idea whether the
 * problem is theirs.
 */
export async function readOra(input: Blob | ArrayBuffer | Uint8Array): Promise<OraReadResult> {
  const JSZip = (await import('jszip')).default;

  let zip: ZipArchive;
  try {
    zip = await JSZip.loadAsync(input as Blob);
  } catch {
    throw new OraReadError('That file is not a readable OpenRaster package.');
  }

  const mimetype = await zip.file('mimetype')?.async('string');
  // Checked but not required. A stricter reader would be within its rights to
  // refuse a package with no `mimetype`, and would also refuse the several
  // real-world writers that omit it — while `stack.xml` present and parseable
  // is a far stronger signal than a filename nobody validates.
  if (mimetype !== undefined && mimetype.trim() !== ORA_MIME_TYPE) {
    throw new OraReadError('That file declares itself as something other than OpenRaster.');
  }

  const manifestResult = await readManifest(zip);
  if (manifestResult) return manifestResult;

  const xml = await zip.file('stack.xml')?.async('string');
  if (!xml) {
    throw new OraReadError('That OpenRaster file has no layer stack (stack.xml is missing).');
  }

  const parsed = parseStackXml(xml);
  if (!parsed) {
    throw new OraReadError('That OpenRaster file’s layer stack could not be read.');
  }

  // Every asset the stack refers to, loaded once. A layer referenced twice —
  // which the format permits and some writers do for a duplicated layer — costs
  // one decode and one copy of the bytes rather than two.
  const wanted = new Set<string>();
  collectSources(parsed.root, wanted);
  const assets = new Map<string, ArchiveEntry>();
  for (const path of wanted) {
    const file = zip.file(path);
    if (!file) continue;
    const [base64, bytes] = await Promise.all([file.async('base64'), file.async('uint8array')]);
    assets.set(path, { base64, bytes });
  }

  const base = createDocument({
    title: parsed.name || 'Imported drawing',
    canvas: {
      width: parsed.width,
      height: parsed.height,
      dpi: parsed.dpi,
      // OpenRaster has no canvas background — a layer stack composites onto
      // nothing — so the imported document is transparent. Defaulting to white
      // would silently flatten away the transparency the file was saved for.
      background: null,
    },
  });

  let selectedNodeId: string | null = null;
  const children = parsed.root.children
    .map((child) => toNode(child, assets, (id) => { selectedNodeId ??= id; }))
    .filter((node): node is DrawingNode => node !== null);

  // A package with no readable layer at all still opens, with the one empty
  // vector layer `createDocument` provides — there is nowhere else for the
  // drawing tools to draw, and an empty canvas is a better answer than an error
  // for a file that is genuinely empty.
  const root: StackNode = children.length > 0
    ? { ...base.root, children }
    : base.root;

  const document: DrawingDocument = {
    ...base,
    root: refreshBounds(normalizeTree(root)),
    colorProfile: (await readEmbeddedProfile(zip)) ?? base.colorProfile,
  };

  return { document, selectedNodeId, fromManifest: false };
}

/**
 * The ICC profile a package carries, as a colour profile for the document.
 *
 * Read from the archive entry rather than from `mergedimage.png`'s `iCCP`
 * chunk, because the entry is the copy that is certain to be the whole profile
 * — the chunk's is zlib-compressed, and inflating it would mean bundling a
 * decompressor to read a file we also wrote uncompressed beside it.
 *
 * Only the profile's presence and name are taken. Nothing here converts pixels
 * between spaces; a document that arrives with a profile keeps it so that
 * exporting again does not lose it, which is the part that would otherwise be
 * silently destructive.
 */
async function readEmbeddedProfile(zip: ZipArchive): Promise<DrawingDocument['colorProfile'] | null> {
  const bytes = await zip.file(ICC_PATH)?.async('uint8array');
  if (!bytes) return null;
  const profile = parseIccProfile(bytes);
  if (!profile) return null;
  return { name: profile.name, iccUri: iccDataUrl(bytes), space: 'srgb', bitDepth: 8 };
}

/**
 * The Neutrino manifest, if this package has a valid one.
 *
 * Validated through `parseDocument`, the same function a stored body goes
 * through, rather than trusted as JSON: the file came from outside, and the
 * defensive coercion that stops a bad opacity costing a whole drawing is
 * exactly as wanted here. A manifest that fails to validate is ignored and the
 * caller falls through to `stack.xml`, so a Neutrino file with a damaged
 * manifest still opens as flat layers instead of not at all.
 */
async function readManifest(zip: ZipArchive): Promise<OraReadResult | null> {
  const raw = await zip.file(MANIFEST_PATH)?.async('string');
  if (!raw) return null;

  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof manifest !== 'object' || manifest === null) return null;

  const stored = (manifest as { document?: unknown }).document;
  if (typeof stored !== 'object' || stored === null) return null;

  const document = parseDocument(JSON.stringify(stored));
  if (!document) return null;

  return {
    document: { ...document, root: refreshBounds(normalizeTree(document.root), symbolTable(document)) },
    selectedNodeId: null,
    fromManifest: true,
  };
}

function collectSources(node: ParsedNode, into: Set<string>): void {
  if (node.type === 'layer') {
    into.add(node.src);
    return;
  }
  for (const child of node.children) collectSources(child, into);
}

/**
 * One parsed element as a document node.
 *
 * Order is preserved exactly: OpenRaster's first child is the topmost layer and
 * so is the model's, which is why nothing here reverses anything.
 */
function toNode(
  parsed: ParsedNode,
  assets: ReadonlyMap<string, ArchiveEntry>,
  onSelected: (id: string) => void,
): DrawingNode | null {
  if (parsed.type === 'stack') {
    const group = createStack(parsed.name || 'Group', {
      opacity: parsed.opacity,
      visible: parsed.visible,
      blendMode: parsed.blendMode,
      locked: parsed.locked,
      isolation: parsed.isolation,
    });
    const children = parsed.children
      .map((child) => toNode(child, assets, onSelected))
      .filter((node): node is DrawingNode => node !== null);
    if (parsed.selected) onSelected(group.id);
    return { ...group, children };
  }

  const source = rasterSourceFor(parsed.src, parsed.x, parsed.y, assets);
  // A `<layer>` whose asset is missing from the archive, or whose bytes are not
  // a picture, is dropped. Keeping it would put a layer in the panel that draws
  // nothing and can never be repaired, and writing the file back out would then
  // point `stack.xml` at an entry that does not exist.
  if (!source) return null;

  const layer = createRasterLayer(source, parsed.name || 'Layer', {
    opacity: parsed.opacity,
    visible: parsed.visible,
    blendMode: parsed.blendMode,
    locked: parsed.locked,
  });
  if (parsed.selected) onSelected(layer.id);
  return layer;
}

function rasterSourceFor(
  src: string,
  x: number,
  y: number,
  assets: ReadonlyMap<string, ArchiveEntry>,
): RasterSource | null {
  const entry = assets.get(src);
  if (!entry) return null;
  const size = imageSize(entry.bytes, src);
  if (!size) return null;
  // The depth is read from the IHDR here because this is the last moment it
  // exists: the browser decodes a 16-bit PNG to eight bits per channel and
  // there is no way to ask afterwards what it was. Recording it is what makes
  // the loss visible in the inspector rather than silent.
  const depth = pngBitDepth(entry.bytes);
  return {
    dataUrl: `data:${mimeForPath(src)};base64,${entry.base64}`,
    width: size.width,
    height: size.height,
    x,
    y,
    ...(depth === 16 ? { bitDepth: 16 as const } : {}),
  };
}
