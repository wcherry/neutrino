/**
 * A diagram as an `.svg` file.
 *
 * Diagrams are stored in one of two formats, and this is the second one. The
 * native format is the document's own JSON under
 * `application/x-neutrino-diagram`; this one is a plain `image/svg+xml` that
 * anything can render, with the same JSON riding inside it as `<metadata>` so
 * that reopening it here is lossless rather than a re-derivation from paths.
 *
 * The two are otherwise interchangeable: the editor opens whichever a Drive
 * file is, saves back in the format it opened, and `Save a copy as…` writes
 * either one.
 *
 * What the *picture* shows is one page — an SVG document is one canvas — while
 * the embedded source carries every page, so a multi-page diagram saved as SVG
 * loses nothing but shows its active page to a reader who is not using
 * Neutrino. `svgPageIndex` is where that choice is recorded.
 */

import {
  embedDiagramSource,
  extractDiagramSource,
  looksLikeSvgBody,
} from '@neutrino/api-diagrams';
import type { DiagramDocument, DiagramPage, DiagramShape } from '../../types';
import { diagramPageToSvg, computeViewBox } from '../diagramSvg';
import { defaultShapeStyle } from '../utils/shapeUtils';

export { looksLikeSvgBody as looksLikeSvg };

/**
 * The page whose picture an SVG-stored diagram shows, recorded on the document
 * so a save does not silently re-point the picture at whichever page happened
 * to be open. Absent means the first page.
 */
export interface SvgBackedDocument extends DiagramDocument {
  svgPageIndex?: number;
}

/** Which page's picture the file shows, clamped to a page that exists. */
export function svgPictureIndex(doc: SvgBackedDocument): number {
  const index = doc.svgPageIndex ?? 0;
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, Math.max(0, doc.pages.length - 1));
}

/**
 * The document as a standalone `.svg` file.
 *
 * Rendered from the model rather than by serialising the live canvas: the
 * canvas carries the viewport transform, selection handles and other people's
 * cursors, none of which belong in a saved file, and a save must not depend on
 * a DOM node being mounted. `exportUtils`' SVG *export* still serialises the
 * canvas, because there the point is a picture of what is on screen.
 *
 * `images` resolves image fills to data URLs; a fill left out falls back to the
 * shape's own colour, which is what keeps a file self-contained rather than
 * pointing at a Drive object nothing outside Neutrino can fetch.
 */
export function diagramDocumentToSvg(
  doc: SvgBackedDocument,
  opts: { images?: ReadonlyMap<string, string>; background?: string | null } = {},
): string {
  const index = svgPictureIndex(doc);
  const page = doc.pages[index];
  const stored: SvgBackedDocument = { ...doc, svgPageIndex: index };

  if (!page) {
    // No page to draw. Still a valid SVG, and still carries the document, so
    // the file round-trips instead of being rejected on the way back in.
    return embedDiagramSource(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"></svg>',
      JSON.stringify(stored),
    );
  }

  // The intrinsic size is the content's own size, so the file opens at 1:1 in a
  // browser and scales from there rather than being fitted into an arbitrary box.
  const [, , width, height] = computeViewBox(page).split(' ').map(Number);
  const svg = diagramPageToSvg(page, {
    width,
    height,
    background: opts.background ?? page.background ?? null,
    images: opts.images,
  });
  return embedDiagramSource(svg, JSON.stringify(stored));
}

/** Whether a parsed value has the shape of a diagram document. */
function isDiagramDocument(value: unknown): value is DiagramDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as DiagramDocument).pages)
  );
}

/**
 * The diagram inside an SVG file, or null when it holds none.
 *
 * Null is the ordinary answer for an SVG that came from anywhere else, and the
 * caller's job then is `svgAsImageDocument` — not to guess at shapes.
 */
export function parseSvgDiagram(svgText: string): SvgBackedDocument | null {
  const source = extractDiagramSource(svgText);
  if (!source) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return isDiagramDocument(parsed) ? (parsed as SvgBackedDocument) : null;
  } catch {
    return null;
  }
}

const FOREIGN_SVG_MAX = 1200;

/** The `width`/`height`, or the `viewBox` extent, an SVG declares. */
function svgIntrinsicSize(svgText: string): { width: number; height: number } {
  const open = /<svg\b[^>]*>/i.exec(svgText)?.[0] ?? '';
  const attr = (name: string): number | null => {
    const raw = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(open)?.[1];
    const value = raw ? parseFloat(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : null;
  };

  let width = attr('width');
  let height = attr('height');
  if (width === null || height === null) {
    const box = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(open)?.[1]?.trim().split(/[\s,]+/);
    if (box?.length === 4) {
      const w = parseFloat(box[2]);
      const h = parseFloat(box[3]);
      if (Number.isFinite(w) && w > 0) width ??= w;
      if (Number.isFinite(h) && h > 0) height ??= h;
    }
  }

  const w = width ?? 400;
  const h = height ?? 300;
  const scale = Math.min(1, FOREIGN_SVG_MAX / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * SVG markup as a `data:` URL for an `<img src>`.
 *
 * Always an image, never markup put into the page: an SVG can carry `<script>`
 * and inline event handlers, and these arrive from a Drive file that may have
 * been shared by someone else — inlining one would run their code in this
 * origin with this session. A browser does not execute either inside an SVG
 * loaded as an image, so the picture is shown and nothing else is.
 */
export function svgDataUrl(svgText: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svgText)}`;
}

/**
 * A foreign SVG as a one-shape diagram: the picture, placed on a page, as an
 * image.
 *
 * Deliberately not an attempt to turn `<rect>`/`<path>`/`<text>` into shapes
 * and connectors. An SVG records how a diagram was *drawn*, not what it is —
 * which box is a decision, which line joins which two boxes, where a page ends
 * — so a structural import would produce a pile of unconnected rectangles that
 * looks like a diagram and behaves like nothing. Bringing it in as an image is
 * honest about that, and it is immediately useful: the picture can be annotated,
 * connected to and drawn over.
 */
export function svgAsImageDocument(svgText: string): DiagramDocument {
  const { width, height } = svgIntrinsicSize(svgText);
  const shape: DiagramShape = {
    id: crypto.randomUUID(),
    type: 'drawio-image',
    x: 40,
    y: 40,
    width,
    height,
    label: '',
    style: { ...defaultShapeStyle(), fill: 'none', stroke: 'none' },
    data: { imageUrl: svgDataUrl(svgText) },
  };

  const page: DiagramPage = {
    id: crypto.randomUUID(),
    name: 'Imported',
    shapes: [shape],
    connectors: [],
    gridEnabled: true,
    gridSize: 20,
    snapEnabled: true,
  };

  return { version: 1, pages: [page], viewport: { x: 0, y: 0, zoom: 1 } };
}

/**
 * Read an SVG as a diagram, whichever kind it is: one this editor wrote comes
 * back whole, anything else comes back as its own picture.
 */
export function svgToDiagramDocument(svgText: string): SvgBackedDocument {
  return parseSvgDiagram(svgText) ?? svgAsImageDocument(svgText);
}
