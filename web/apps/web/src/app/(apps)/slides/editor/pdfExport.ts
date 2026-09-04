/**
 * PDF export for a presentation (issue #100).
 *
 * One slide per page at 720 × 405 pt — the 10in × 5.625in 16:9 slide the .pptx
 * export writes — with every element drawn at an `absolutePosition` computed
 * from the percentage it is stored as, in the order it appears on the slide, so
 * the page stacks the way the canvas does.
 *
 * The work is split in two on purpose. `prepareSlidesPdfAssets` does everything
 * that needs a browser — decrypting a Drive image, rasterising it through a
 * canvas, fetching a diagram — and `buildSlidesPdfDefinition` is pure over the
 * presentation plus those assets, so the whole mapping is unit-testable without
 * pdfmake and without a DOM.
 *
 * What a PDF cannot carry: transitions and animations (a page is a still), the
 * fonts a slide names (pdfmake's virtual file system holds Roboto only, so text
 * keeps its size, weight, slant and colour but not its family), and a video,
 * which is drawn as its poster frame with the URL under it.
 */

import { SHAPE_CATALOG } from './slideEditorConstants';
import { getVideoEmbedInfo } from './slideEditorHelpers';
import type {
  DiagramElement,
  ImageElement,
  LineElement,
  ShapeElement,
  SheetEmbedElement,
  Slide,
  SlideElement,
  SlidePresentation,
  TextElement,
  VideoElement,
} from './slideEditorTypes';
import { parseDriveImageRef, resolveDriveImageDataUrl } from '@/lib/driveImages';
import { hasTransparency, loadImage } from '@/lib/pdfImages';
import { diagramPageToSvg, fetchDiagramPage } from '@/app/(apps)/diagrams/editor/diagramSvg';

// ── Page geometry ─────────────────────────────────────────────────────────────

/** 10in at 72dpi — pptxgenjs' LAYOUT_16x9, so both exports lay a deck out alike. */
export const PDF_PAGE_WIDTH = 720;
/** 5.625in at 72dpi. */
export const PDF_PAGE_HEIGHT = 405;

/**
 * Model lengths — font sizes, stroke widths, paragraph spacing — are canvas
 * pixels, and this is the same ¾ the .pptx export applies to a font size. Using
 * it for every length keeps an element's proportions on the page identical to
 * its proportions on the canvas.
 */
const PX_TO_PT = 0.75;

/** Enough oversampling that a bitmap still looks sharp printed. */
const RASTER_SCALE = 2;
/** Above this the re-encode costs more than the extra detail is worth. */
const MAX_RASTER_EDGE = 2400;
/** Quality used when an opaque image is re-encoded as the smaller JPEG. */
const JPEG_QUALITY = 0.92;

const px = (pct: number) => (pct / 100) * PDF_PAGE_WIDTH;
const py = (pct: number) => (pct / 100) * PDF_PAGE_HEIGHT;

// ── Document definition ───────────────────────────────────────────────────────

/**
 * A pdfmake content node. pdfmake ships no types (see `vendor.d.ts`), and the
 * definition here is data either way — it is built, asserted over in tests, and
 * handed to `createPdf` untouched.
 */
export type PdfNode = Record<string, unknown>;

export interface SlidesPdfDefinition extends Record<string, unknown> {
  pageSize: { width: number; height: number };
  pageMargins: [number, number, number, number];
  content: PdfNode[];
}

export interface SlidesPdfAssets {
  /** Rasterised bitmaps as data URLs, already cropped to the box they fill. */
  images: Map<string, string>;
  /** Diagram elements rendered to SVG, keyed by element id. */
  diagrams: Map<string, string>;
}

export function emptyAssets(): SlidesPdfAssets {
  return { images: new Map(), diagrams: new Map() };
}

/** Assets are keyed by element id; a slide background has no element to key on. */
export function backgroundImageKey(slideId: string): string {
  return `background:${slideId}`;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

/** XML-escapes a value so a colour or a path cannot break out of an attribute. */
function xml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * PDFKit understands hex and CSS colour names and throws on anything else, so a
 * colour it could not parse would cost the whole export rather than one fill.
 */
export function safeColor(value: string | undefined | null, fallback: string): string {
  const v = (value ?? '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  if (/^[a-z]+$/i.test(v)) return v;
  return fallback;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Gradients ─────────────────────────────────────────────────────────────────

export interface GradientStop {
  color: string;
  /** Position along the gradient line, 0–1. */
  offset: number;
}

export interface LinearGradient {
  /** CSS angle in degrees: 0 points to the top, growing clockwise. */
  angle: number;
  stops: GradientStop[];
}

/** Splits on top-level commas only, so `rgb(0, 0, 0)` survives as one argument. */
function splitArgs(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const SIDE_ANGLES: Record<string, number> = {
  'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270,
  'to top right': 45, 'to right top': 45,
  'to bottom right': 135, 'to right bottom': 135,
  'to bottom left': 225, 'to left bottom': 225,
  'to top left': 315, 'to left top': 315,
};

/**
 * Parses the `linear-gradient(...)` strings a slide background is stored as.
 * Returns null for a radial or otherwise unrecognised gradient, which the
 * caller paints as a flat colour instead.
 */
export function parseLinearGradient(css: string): LinearGradient | null {
  const match = /^\s*linear-gradient\s*\(([\s\S]*)\)\s*$/i.exec(css ?? '');
  if (!match) return null;
  const args = splitArgs(match[1]);
  if (args.length === 0) return null;

  // CSS defaults to `to bottom` when the first argument is already a colour.
  let angle = 180;
  const first = args[0].toLowerCase();
  const deg = /^(-?[\d.]+)deg$/.exec(first);
  if (deg) {
    angle = parseFloat(deg[1]);
    args.shift();
  } else if (first.startsWith('to ')) {
    angle = SIDE_ANGLES[first.replace(/\s+/g, ' ')] ?? 180;
    args.shift();
  }

  const raw = args.map((arg) => {
    const pct = /\s(-?[\d.]+)%$/.exec(arg);
    return {
      color: (pct ? arg.slice(0, pct.index) : arg).trim(),
      offset: pct ? parseFloat(pct[1]) / 100 : null,
    };
  }).filter((s) => s.color.length > 0);
  if (raw.length < 2) return null;

  // An unpositioned stop sits where evenly spacing the stops would put it,
  // which is what CSS does for the common `#a, #b` form.
  const stops = raw.map((s, i) => ({
    color: s.color,
    offset: s.offset ?? i / (raw.length - 1),
  }));
  return { angle: ((angle % 360) + 360) % 360, stops };
}

/**
 * The gradient as an SVG document filling `width` × `height`.
 *
 * The gradient line runs through the centre of the box in the CSS direction and
 * is as long as the box's projection onto it, so a 135° gradient reaches both
 * corners exactly as it does in the browser.
 */
export function gradientSvg(css: string, width: number, height: number): string | null {
  const parsed = parseLinearGradient(css);
  if (!parsed) return null;
  const rad = (parsed.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = Math.abs(width * dx) + Math.abs(height * dy);
  const cx = width / 2;
  const cy = height / 2;
  const stops = parsed.stops
    .map((s) => `<stop offset="${round(s.offset)}" stop-color="${xml(s.color)}"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}">` +
    `<defs><linearGradient id="bg" gradientUnits="userSpaceOnUse"` +
    ` x1="${round(cx - (dx * len) / 2)}" y1="${round(cy - (dy * len) / 2)}"` +
    ` x2="${round(cx + (dx * len) / 2)}" y2="${round(cy + (dy * len) / 2)}">${stops}</linearGradient></defs>` +
    `<rect width="${round(width)}" height="${round(height)}" fill="url(#bg)"/></svg>`
  );
}

// ── Elements ──────────────────────────────────────────────────────────────────

function fullPageRect(color: string): PdfNode {
  return {
    absolutePosition: { x: 0, y: 0 },
    canvas: [{ type: 'rect', x: 0, y: 0, w: PDF_PAGE_WIDTH, h: PDF_PAGE_HEIGHT, color }],
  };
}

function backgroundNodes(slide: Slide, assets: SlidesPdfAssets): PdfNode[] {
  const bg = slide.background;

  if (bg.type === 'image') {
    const data = assets.images.get(backgroundImageKey(slide.id));
    // An image that could not be fetched leaves the slide white rather than
    // transparent, which is what a viewer would show it as anyway.
    if (!data) return [fullPageRect('#ffffff')];
    return [{
      absolutePosition: { x: 0, y: 0 },
      image: data,
      width: PDF_PAGE_WIDTH,
      height: PDF_PAGE_HEIGHT,
    }];
  }

  if (bg.type === 'gradient') {
    const svg = gradientSvg(bg.value, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT);
    if (svg) {
      return [{ absolutePosition: { x: 0, y: 0 }, svg, width: PDF_PAGE_WIDTH, height: PDF_PAGE_HEIGHT }];
    }
    const first = parseLinearGradient(bg.value)?.stops[0]?.color;
    return [fullPageRect(safeColor(first, '#ffffff'))];
  }

  return [fullPageRect(safeColor(bg.value, '#ffffff'))];
}

function textNode(el: TextElement): PdfNode {
  const s = el.style;
  const listType = s.listType ?? 'none';
  const lines = el.content.split('\n');
  const spaceBefore = (s.spaceBefore ?? 0) * PX_TO_PT;
  const spaceAfter = (s.spaceAfter ?? 0) * PX_TO_PT;
  const decoration = [
    s.underline ? 'underline' : null,
    s.strikethrough ? 'lineThrough' : null,
  ].filter(Boolean) as string[];

  const node: PdfNode = {
    absolutePosition: { x: round(px(el.x)), y: round(py(el.y)) },
    // A detached block's available width runs to the right edge of the page, so
    // the box has to be a column of a stated width or the text would wrap
    // against the slide instead of against its own frame.
    columns: [{
      width: round(px(el.w)),
      // A blank line still occupies its height, as it does on the canvas.
      stack: lines.map((line, i) => ({
        text:
          (listType === 'bullet' ? '•  ' : listType === 'numbered' ? `${i + 1}.  ` : '') +
          (line || ' '),
        margin: [0, i > 0 ? spaceBefore : 0, 0, i < lines.length - 1 ? spaceAfter : 0],
      })),
    }],
    fontSize: round(s.fontSize * PX_TO_PT),
    bold: s.bold,
    italics: s.italic,
    color: safeColor(s.color, '#000000'),
    alignment: s.align,
    lineHeight: s.lineHeight ?? 1.3,
  };
  if (decoration.length > 0) node.decoration = decoration.length === 1 ? decoration[0] : decoration;
  if (s.backgroundColor) node.background = safeColor(s.backgroundColor, '#ffffff');
  return node;
}

function shapeNode(el: ShapeElement): PdfNode | null {
  const def = SHAPE_CATALOG[el.shape];
  if (!def) return null;
  const w = round(px(el.w));
  const h = round(py(el.h));
  const dash = el.strokeDash ? ` stroke-dasharray="${xml(el.strokeDash)}"` : '';
  // The catalog paths are drawn in a 0–100 box and stretched to the element, as
  // the canvas does; `vector-effect` is what keeps the outline from stretching
  // with it.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"` +
    ` viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<path d="${xml(def.path)}" fill="${safeColor(el.fill, 'none')}"` +
    ` stroke="${el.stroke ? safeColor(el.stroke, 'none') : 'none'}"` +
    ` stroke-width="${round(el.strokeWidth * PX_TO_PT)}"${dash}` +
    ` vector-effect="non-scaling-stroke"/></svg>`;
  return { absolutePosition: { x: round(px(el.x)), y: round(py(el.y)) }, svg, width: w, height: h };
}

/**
 * The arrowhead the canvas draws with an SVG marker, as an explicit polygon.
 *
 * svg-to-pdfkit — what pdfmake draws SVG with — has no `auto-start-reverse`, so
 * a marker at the start of a line would point back down it. The geometry
 * matches the marker: the tip sits on the endpoint and the head is `size` long
 * and `size` across.
 */
function arrowHead(
  tipX: number, tipY: number, fromX: number, fromY: number,
  size: number, kind: 'arrow' | 'triangle', color: string, strokeWidth: number,
): string {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const half = size / 2;
  const points = [
    `${round(baseX - uy * half)},${round(baseY + ux * half)}`,
    `${round(tipX)},${round(tipY)}`,
    `${round(baseX + uy * half)},${round(baseY - ux * half)}`,
  ].join(' ');
  return kind === 'triangle'
    ? `<polygon points="${points}" fill="${color}"/>`
    : `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="${round(strokeWidth)}"/>`;
}

function lineNode(el: LineElement): PdfNode {
  const x1 = px(el.x1);
  const y1 = py(el.y1);
  const x2 = px(el.x2);
  const y2 = py(el.y2);
  const color = safeColor(el.stroke, '#000000');
  const sw = (el.strokeWidth || 2) * PX_TO_PT;
  const headSize = Math.max(8 * PX_TO_PT, sw * 4);
  const dash = el.strokeDash ? ` stroke-dasharray="${xml(el.strokeDash)}"` : '';

  const parts = [
    `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}"` +
    ` stroke="${color}" stroke-width="${round(sw)}"${dash}/>`,
  ];
  const startArrow = el.startArrow ?? 'none';
  const endArrow = el.endArrow ?? 'none';
  if (startArrow !== 'none') parts.push(arrowHead(x1, y1, x2, y2, headSize, startArrow, color, sw));
  if (endArrow !== 'none') parts.push(arrowHead(x2, y2, x1, y1, headSize, endArrow, color, sw));

  return {
    absolutePosition: { x: 0, y: 0 },
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PDF_PAGE_WIDTH}" height="${PDF_PAGE_HEIGHT}">` +
      `${parts.join('')}</svg>`,
    width: PDF_PAGE_WIDTH,
    height: PDF_PAGE_HEIGHT,
  };
}

function imageNode(el: ImageElement, assets: SlidesPdfAssets): PdfNode | null {
  const data = assets.images.get(el.id);
  if (!data) return null;
  return {
    absolutePosition: { x: round(px(el.x)), y: round(py(el.y)) },
    image: data,
    width: round(px(el.w)),
    height: round(py(el.h)),
  };
}

function diagramNode(el: DiagramElement, assets: SlidesPdfAssets): PdfNode | null {
  const svg = assets.diagrams.get(el.id);
  if (!svg) return null;
  return {
    absolutePosition: { x: round(px(el.x)), y: round(py(el.y)) },
    svg,
    width: round(px(el.w)),
    height: round(py(el.h)),
  };
}

/** A video is a still on paper: the canvas' black frame, a play mark, the URL. */
function videoNodes(el: VideoElement): PdfNode[] {
  const w = round(px(el.w));
  const h = round(py(el.h));
  const x = round(px(el.x));
  const y = round(py(el.y));
  const mark = Math.min(w, h) * 0.22;
  const cx = w / 2;
  const cy = h / 2;
  const nodes: PdfNode[] = [{
    absolutePosition: { x, y },
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" fill="#000000"/>` +
      `<polygon points="${round(cx - mark / 2)},${round(cy - mark / 2)}` +
      ` ${round(cx + mark / 2)},${round(cy)}` +
      ` ${round(cx - mark / 2)},${round(cy + mark / 2)}" fill="#ffffff"/></svg>`,
    width: w,
    height: h,
  }];
  const url = getVideoEmbedInfo(el.url).embedUrl || el.url;
  if (url) {
    nodes.push({
      absolutePosition: { x, y: round(y + h - 14) },
      columns: [{ width: w, text: url }],
      fontSize: 6,
      color: '#e5e7eb',
      alignment: 'center',
    });
  }
  return nodes;
}

/** Height of one embedded-sheet row, which is what decides how many fit. */
const EMBED_ROW_HEIGHT = 12;
const EMBED_FONT_SIZE = 7;
/** Past this a column is too narrow to read anything in. */
const EMBED_MAX_COLS = 26;
/** pdfmake's default table layout pads a cell by this much on each side. */
const EMBED_CELL_PADDING = 4;
/** Gap between the embed's card edge and the table inside it. */
const EMBED_CARD_INSET = 4;

/**
 * A sheet embed as a table of its cached values.
 *
 * The cache is what the slide is showing — the embed renderer only refetches
 * when it is on screen — so the export never goes to the network for one, and a
 * spreadsheet that has since been deleted still exports what the slide showed.
 */
function sheetEmbedNodes(el: SheetEmbedElement): PdfNode[] {
  let rows: unknown[][] = [];
  try {
    const parsed = el.cachedData ? JSON.parse(el.cachedData) : null;
    if (Array.isArray(parsed)) rows = parsed.filter(Array.isArray) as unknown[][];
  } catch {
    rows = [];
  }

  const x = round(px(el.x));
  const y = round(py(el.y));
  const w = round(px(el.w));
  const h = round(py(el.h));
  // The embed is a white card on the canvas, and it has to be one here too: the
  // table's rules and text are dark, and a dark slide behind them would leave
  // the values all but invisible.
  const nodes: PdfNode[] = [{
    absolutePosition: { x, y },
    canvas: [{
      type: 'rect', x: 0, y: 0, w, h, r: 3,
      color: '#ffffff', lineWidth: 0.5, lineColor: '#d1d5db',
    }],
  }];
  const inner = Math.max(4, w - EMBED_CARD_INSET * 2);
  const left = x + EMBED_CARD_INSET;
  let top = y + EMBED_CARD_INSET;

  if (el.title) {
    nodes.push({
      absolutePosition: { x: left, y: top },
      columns: [{ width: inner, text: el.title }],
      fontSize: 8,
      bold: true,
      color: '#374151',
    });
    top += 12;
  }

  if (rows.length === 0) return nodes;

  const maxRows = Math.max(1, Math.floor((y + h - EMBED_CARD_INSET - top) / EMBED_ROW_HEIGHT));
  const cols = Math.min(EMBED_MAX_COLS, Math.max(...rows.map((r) => r.length), 1));
  const body = rows.slice(0, maxRows).map((row) =>
    Array.from({ length: cols }, (_, c) => {
      const cell = row[c];
      return { text: cell === null || cell === undefined ? '' : String(cell), fontSize: EMBED_FONT_SIZE };
    }),
  );

  // A `*` width would stretch the table to the page edge, since the block is
  // detached; column widths are content widths, so the default layout's 4pt of
  // padding either side comes off each one to land on the element's own width.
  const colWidth = Math.max(4, round(inner / cols - EMBED_CELL_PADDING * 2));

  nodes.push({
    absolutePosition: { x: left, y: top },
    table: { widths: Array.from({ length: cols }, () => colWidth), body },
  });
  return nodes;
}

function elementNodes(el: SlideElement, assets: SlidesPdfAssets): PdfNode[] {
  switch (el.type) {
    case 'text': return [textNode(el)];
    case 'shape': { const n = shapeNode(el); return n ? [n] : []; }
    case 'line': return [lineNode(el)];
    case 'image': { const n = imageNode(el, assets); return n ? [n] : []; }
    case 'diagram': { const n = diagramNode(el, assets); return n ? [n] : []; }
    case 'video': return videoNodes(el);
    case 'sheetEmbed': return sheetEmbedNodes(el);
    default: return [];
  }
}

export interface BuildPdfOptions {
  assets?: SlidesPdfAssets;
  /** Written into the PDF's document properties. */
  title?: string;
}

/**
 * The whole presentation as a pdfmake document definition.
 *
 * Nothing here touches the DOM or the network: an image or diagram is drawn
 * only if `assets` already holds it, and is left out rather than failing the
 * export if it does not.
 */
export function buildSlidesPdfDefinition(
  presentation: SlidePresentation,
  opts: BuildPdfOptions = {},
): SlidesPdfDefinition {
  const assets = opts.assets ?? emptyAssets();
  const content: PdfNode[] = [];

  presentation.slides.forEach((slide, index) => {
    // Every node is absolutely positioned, so nothing advances the cursor and
    // nothing would ever start a new page on its own.
    if (index > 0) {
      content.push({ text: ' ', fontSize: 1, margin: [0, 0, 0, 0], pageBreak: 'before' });
    }
    content.push(...backgroundNodes(slide, assets));
    for (const el of slide.elements) content.push(...elementNodes(el, assets));
  });

  return {
    pageSize: { width: PDF_PAGE_WIDTH, height: PDF_PAGE_HEIGHT },
    pageMargins: [0, 0, 0, 0],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 12, lineHeight: 1.3 },
    info: { title: opts.title || 'Presentation' },
  };
}

// ── Assets ────────────────────────────────────────────────────────────────────

/** The CSS filter chain `SlideRenderer` puts on an image, for a 2D context. */
export function imageFilter(el: ImageElement): string {
  const parts: string[] = [];
  if (el.brightness) parts.push(`brightness(${1 + el.brightness / 100})`);
  if (el.contrast) parts.push(`contrast(${1 + el.contrast / 100})`);
  if (el.saturation) parts.push(`saturate(${Math.max(0, 1 + el.saturation / 100)})`);
  if (el.warmth > 0) {
    parts.push(`sepia(${(el.warmth / 100) * 0.5})`);
    parts.push(`hue-rotate(${el.warmth * -0.1}deg)`);
  } else if (el.warmth < 0) {
    parts.push(`hue-rotate(${el.warmth * 0.5}deg)`);
  }
  return parts.join(' ');
}

interface RasterOptions {
  objectFit: 'cover' | 'contain' | 'fill';
  filter?: string;
  opacity?: number;
  tintColor?: string;
  tintStrength?: number;
}

/**
 * An image redrawn to fill exactly its box on the page.
 *
 * pdfmake stretches a bitmap to the width and height it is given and clips
 * nothing, so `cover` has to be cropped here or the picture would spill over
 * whatever is beside it. Doing the fit on a canvas also re-encodes the bytes,
 * which is separately necessary: pdfmake embeds PNG and JPEG and throws on
 * anything else, failing the whole export over one WebP.
 */
async function rasterize(src: string, boxW: number, boxH: number, opts: RasterOptions): Promise<string> {
  const img = await loadImage(src);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new Error('The image has no intrinsic size.');

  const scale = Math.min(
    RASTER_SCALE,
    MAX_RASTER_EDGE / Math.max(boxW, boxH),
  );
  const cw = Math.max(1, Math.round(boxW * scale));
  const ch = Math.max(1, Math.round(boxH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');

  let dw = cw;
  let dh = ch;
  if (opts.objectFit !== 'fill') {
    const fit = opts.objectFit === 'contain'
      ? Math.min(cw / iw, ch / ih)
      : Math.max(cw / iw, ch / ih);
    dw = iw * fit;
    dh = ih * fit;
  }
  const dx = (cw - dw) / 2;
  const dy = (ch - dh) / 2;

  if (opts.filter) ctx.filter = opts.filter;
  ctx.globalAlpha = opts.opacity ?? 1;
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  if (opts.tintColor && (opts.tintStrength ?? 0) > 0) {
    // Only over the picture itself — a `contain` fit leaves bars the canvas
    // shows as the slide behind it, not as tinted black.
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = Math.min(1, opts.tintStrength ?? 0);
    ctx.fillStyle = opts.tintColor;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  if (hasTransparency(ctx, cw, ch)) return canvas.toDataURL('image/png');
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/** A stored src as bytes: a Drive reference is fetched and decrypted first. */
async function resolveSrc(src: string): Promise<string> {
  const fileId = parseDriveImageRef(src);
  return fileId ? resolveDriveImageDataUrl(fileId) : src;
}

/**
 * Everything the definition needs that only a browser can produce.
 *
 * One unreachable picture or deleted diagram must not cost the user the export,
 * so a failure is logged and the element is simply left off its slide.
 */
export async function prepareSlidesPdfAssets(presentation: SlidePresentation): Promise<SlidesPdfAssets> {
  const assets = emptyAssets();
  const jobs: Promise<void>[] = [];

  for (const slide of presentation.slides) {
    if (slide.background.type === 'image') {
      const bg = slide.background;
      jobs.push((async () => {
        try {
          const src = await resolveSrc(bg.value);
          const data = await rasterize(src, PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT, {
            objectFit: bg.objectFit ?? 'cover',
          });
          assets.images.set(backgroundImageKey(slide.id), data);
        } catch (err) {
          console.warn('[slides:pdf] background image skipped', slide.id, err);
        }
      })());
    }

    for (const el of slide.elements) {
      if (el.type === 'image') {
        jobs.push((async () => {
          try {
            const src = await resolveSrc(el.src);
            const data = await rasterize(src, px(el.w), py(el.h), {
              objectFit: el.objectFit ?? 'cover',
              filter: imageFilter(el),
              opacity: el.opacity ?? 1,
              tintColor: el.tintColor,
              tintStrength: el.tintStrength,
            });
            assets.images.set(el.id, data);
          } catch (err) {
            console.warn('[slides:pdf] image skipped', el.id, err);
          }
        })());
      } else if (el.type === 'diagram') {
        jobs.push((async () => {
          try {
            const page = await fetchDiagramPage(el.diagramId, el.pageIndex);
            if (!page) return;
            assets.diagrams.set(el.id, diagramPageToSvg(page, {
              width: px(el.w),
              height: py(el.h),
            }));
          } catch (err) {
            console.warn('[slides:pdf] diagram skipped', el.id, err);
          }
        })());
      }
    }
  }

  await Promise.all(jobs);
  return assets;
}

// ── Export ────────────────────────────────────────────────────────────────────

/** Builds the deck as PDF bytes, without downloading them. */
export async function buildPdfBlob(title: string, presentation: SlidePresentation): Promise<Blob> {
  const assets = await prepareSlidesPdfAssets(presentation);
  const docDef = buildSlidesPdfDefinition(presentation, { assets, title });

  const pdfMake = (await import('pdfmake/build/pdfmake')).default;
  const pdfFonts = (await import('pdfmake/build/vfs_fonts')).default;
  // pdfmake ships no types; the local stubs predate the vfs/fonts API shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pm = pdfMake as any;
  pm.vfs = pdfFonts;
  pm.fonts = {
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  };

  // pdfmake 0.3.x returns a promise from getBlob(); the stub declares 0.2.x's
  // callback, so this goes through a cast like the docs exporter's does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob: Blob = await (pm.createPdf(docDef) as any).getBlob();
  if (!blob) throw new Error('pdfmake returned no data.');
  return blob;
}

/** Downloads the deck as `<title>.pdf`. */
export async function exportAsPdf(title: string, presentation: SlidePresentation): Promise<void> {
  const blob = await buildPdfBlob(title, presentation);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
