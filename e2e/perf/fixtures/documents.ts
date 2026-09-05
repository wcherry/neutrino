/**
 * Building the fixture documents themselves — the bytes, not the upload.
 *
 * Docs, Sheets and Slides store OOXML since issue #127: a document is a real
 * `.docx`, a spreadsheet a real `.xlsx`, a deck a real `.pptx`. The fixtures
 * are therefore built as OOXML too, with the same libraries any other office
 * suite would use, because that is the read path the scenarios are measuring —
 * a fixture written in the legacy `x-neutrino-*` JSON would open through a
 * different, cheaper code path and quietly measure the wrong thing.
 *
 * Diagrams and Drawings have no OOXML counterpart and keep their own JSON, so
 * theirs is built by hand against the shapes in `native_types.rs`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const ASSET_DIR = path.join(__dirname, 'assets');

/** Deterministic filler, so every run seeds byte-identical fixtures. */
const WORDS = [
  'quota', 'ciphertext', 'keyring', 'rollout', 'latency', 'viewport', 'sealed',
  'ledger', 'roster', 'baseline', 'threshold', 'envelope', 'gradient', 'digest',
  'rotation', 'snapshot', 'anchor', 'manifest', 'payload', 'tolerance',
];

export function sentence(seed: number, words = 14): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) out.push(WORDS[(seed * 7 + i * 13) % WORDS.length]);
  return `${out.join(' ')}.`;
}

export function paragraph(seed: number): string {
  return [sentence(seed), sentence(seed + 1), sentence(seed + 2)].join(' ');
}

// ── .docx ───────────────────────────────────────────────────────────────────

/**
 * A document of `count` paragraphs, with a heading every twentieth.
 *
 * The headings are not decoration: `readDocx` resolves a paragraph's style by
 * id, and a fixture of nothing but body text would skip that branch entirely.
 */
export async function buildDocx(count: number): Promise<Buffer> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');

  const children: InstanceType<typeof Paragraph>[] = [];
  for (let i = 0; i < count; i += 1) {
    if (i % 20 === 0) {
      children.push(
        new Paragraph({
          text: `Section ${Math.floor(i / 20) + 1}`,
          heading: HeadingLevel.HEADING_2,
        }),
      );
    }
    children.push(
      new Paragraph({
        children: [
          new TextRun(paragraph(i)),
          // A little inline formatting per paragraph, so run-splitting is
          // exercised rather than one run per paragraph.
          new TextRun({ text: ` ${sentence(i + 100, 4)}`, bold: i % 3 === 0 }),
        ],
      }),
    );
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ── .xlsx ───────────────────────────────────────────────────────────────────

export interface SheetShape {
  /** Total populated cells, spread across `columns` columns. */
  cells: number;
  columns?: number;
  /**
   * How many trailing rows carry a formula depending on the column above them.
   * `D3` — "edit one cell that N formulas depend on" — needs a real dependency
   * graph, not a grid of literals.
   */
  formulaRows?: number;
}

export async function buildXlsx(shape: SheetShape): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const columns = shape.columns ?? 20;
  const rows = Math.max(1, Math.ceil(shape.cells / columns));

  // Built as an array of arrays rather than cell by cell: `aoa_to_sheet` is
  // an order of magnitude faster on the L fixture, and the seeding time is
  // pure overhead on every run.
  const data: (string | number)[][] = [];
  const header: string[] = [];
  for (let c = 0; c < columns; c += 1) header.push(`Column ${c + 1}`);
  data.push(header);

  for (let r = 0; r < rows; r += 1) {
    const row: (string | number)[] = [];
    for (let c = 0; c < columns; c += 1) {
      row.push(c % 4 === 0 ? sentence(r + c, 3) : ((r * 31 + c * 17) % 997) + r / 100);
    }
    data.push(row);
  }

  const sheet = XLSX.utils.aoa_to_sheet(data);

  // The dependency tail. Each formula sums a column of the literals above, so
  // editing any cell in that column invalidates every one of them.
  const formulaRows = shape.formulaRows ?? 0;
  for (let i = 0; i < formulaRows; i += 1) {
    const r = rows + 2 + i;
    for (let c = 1; c < columns; c += 1) {
      const col = XLSX.utils.encode_col(c);
      const ref = XLSX.utils.encode_cell({ r, c });
      sheet[ref] = { t: 'n', f: `SUM(${col}2:${col}${rows + 1})` };
    }
  }
  if (formulaRows > 0) {
    sheet['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rows + 2 + formulaRows, c: columns - 1 },
    });
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Sheet1');
  return Buffer.from(
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  );
}

// ── .pptx ───────────────────────────────────────────────────────────────────

export async function buildPptx(slides: number, elementsPerSlide = 4): Promise<Buffer> {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const deck = new PptxGenJS();

  for (let i = 0; i < slides; i += 1) {
    const slide = deck.addSlide();
    slide.addText(`Slide ${i + 1}`, {
      x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 32, bold: true,
    });
    for (let e = 0; e < elementsPerSlide; e += 1) {
      slide.addText(sentence(i * 10 + e, 8), {
        x: 0.5 + (e % 2) * 4.6,
        y: 1.5 + Math.floor(e / 2) * 1.6,
        w: 4.2,
        h: 1.2,
        fontSize: 14,
      });
    }
  }

  // `write` resolves to a Node Buffer under `nodebuffer`; the typing is loose
  // enough that the cast is unavoidable.
  return (await deck.write({ outputType: 'nodebuffer' })) as Buffer;
}

// ── Native JSON types ───────────────────────────────────────────────────────

/**
 * A diagram of `nodes` boxes wired in a chain — the shape `E4` drags around.
 *
 * Built against `DiagramShape`/`DiagramConnector` in
 * `apps/web/src/app/(apps)/diagrams/types.ts`, in full, and that matters more
 * than it looks: the editor renders straight from the stored model with no
 * defaulting, so a shape carrying `text` where it wants `label`, or a partial
 * `style`, does not degrade — the whole page dies with "Application error: a
 * client-side exception has occurred", which is how the first version of this
 * fixture failed.
 */
export function buildDiagram(nodes: number): string {
  const shapeStyle = {
    fill: '#e0e7ff',
    stroke: '#4f46e5',
    strokeWidth: 2,
    fontSize: 14,
    fontFamily: 'Inter',
    textColor: '#111827',
    textAlign: 'center' as const,
    opacity: 1,
  };
  const connectorStyle = {
    stroke: '#6b7280',
    strokeWidth: 1,
    startArrow: 'none' as const,
    endArrow: 'arrow' as const,
    fontSize: 12,
    fontFamily: 'Inter',
    textColor: '#111827',
    opacity: 1,
  };

  const shapes = Array.from({ length: nodes }, (_, i) => ({
    id: `n${i}`,
    type: 'rectangle',
    x: 80 + (i % 20) * 160,
    y: 80 + Math.floor(i / 20) * 120,
    width: 120,
    height: 64,
    label: `Node ${i + 1}`,
    style: shapeStyle,
    rotation: 0,
  }));
  const connectors = Array.from({ length: Math.max(0, nodes - 1) }, (_, i) => ({
    id: `c${i}`,
    type: 'orthogonal',
    sourceId: `n${i}`,
    targetId: `n${i + 1}`,
    waypoints: [],
    label: '',
    style: connectorStyle,
  }));

  return JSON.stringify({
    version: 1,
    pages: [{ id: 'page-1', name: 'Page 1', shapes, connectors }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
}

/** A drawing of `shapes` rectangles — `DrawingContent` in the drawing editor. */
export function buildDrawing(shapes: number): string {
  return JSON.stringify({
    version: 1,
    shapes: Array.from({ length: shapes }, (_, i) => ({
      id: `s${i}`,
      type: 'rectangle',
      x: (i % 30) * 40,
      y: Math.floor(i / 30) * 40,
      width: 32,
      height: 32,
      points: [],
      text: '',
      fill: '#93c5fd',
      stroke: '#1d4ed8',
      strokeWidth: 1,
      rotation: 0,
      opacity: 1,
    })),
  });
}

// ── Images ──────────────────────────────────────────────────────────────────

/**
 * The committed photo fixtures.
 *
 * Real JPEGs rather than generated bytes, for two reasons: the photo scenarios
 * measure decode as well as decrypt, and a fixture that is identical on every
 * run and every machine is the only kind whose numbers can be compared. The
 * thumbnail is separate because that is what the grid actually paints — the
 * full-size bytes are only fetched when a photo is opened.
 */
export const PHOTO = {
  thumb: path.join(ASSET_DIR, 'photo-thumb.jpg'),
  standard: path.join(ASSET_DIR, 'photo-std.jpg'),
  /** 4000 × 3000 — the 12 MP case in `E6`. */
  large: path.join(ASSET_DIR, 'photo-large.jpg'),
} as const;

let thumbCache: string | null = null;

/** The thumbnail as the base64 `thumbnail_b64` the upload endpoint takes. */
export function thumbnailB64(): string {
  thumbCache ??= fs.readFileSync(PHOTO.thumb).toString('base64');
  return thumbCache;
}

export function readPhoto(which: keyof typeof PHOTO): Buffer {
  return fs.readFileSync(PHOTO[which]);
}
