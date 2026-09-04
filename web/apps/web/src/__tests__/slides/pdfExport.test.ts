/**
 * The Slides PDF export (issue #100).
 *
 * `buildSlidesPdfDefinition` is the whole mapping from a presentation to a
 * pdfmake document, and it is pure over the assets it is handed, so these cover
 * it without pdfmake, a canvas or a network. The browser half — decrypting and
 * rasterising the pictures — is what `assets` stands in for here.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/driveImages', () => ({
  parseDriveImageRef: () => null,
  resolveDriveImageDataUrl: vi.fn(),
}));

vi.mock('@/app/(apps)/diagrams/editor/diagramSvg', () => ({
  diagramPageToSvg: vi.fn(),
  fetchDiagramPage: vi.fn(),
}));

import {
  PDF_PAGE_HEIGHT,
  PDF_PAGE_WIDTH,
  backgroundImageKey,
  buildSlidesPdfDefinition,
  emptyAssets,
  gradientSvg,
  imageFilter,
  parseLinearGradient,
  safeColor,
} from '@/app/(apps)/slides/editor/pdfExport';
import type { PdfNode } from '@/app/(apps)/slides/editor/pdfExport';
import type {
  ImageElement,
  Slide,
  SlideElement,
  SlidePresentation,
  TextElement,
} from '@/app/(apps)/slides/editor/slideEditorTypes';
import { DEFAULT_THEME } from '@/app/(apps)/slides/editor/slideEditorConstants';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function slide(over: Partial<Slide> = {}): Slide {
  return {
    id: 's1',
    background: { type: 'color', value: '#ffffff' },
    elements: [],
    notes: '',
    transition: 'none',
    ...over,
  };
}

function deck(slides: Slide[]): SlidePresentation {
  return { slides, theme: DEFAULT_THEME };
}

function text(over: Partial<TextElement> = {}): TextElement {
  return {
    id: 't1',
    type: 'text',
    x: 10, y: 20, w: 50, h: 15,
    content: 'Hello',
    style: {
      fontSize: 40, bold: true, italic: false, underline: false,
      color: '#123456', align: 'center', fontFamily: 'Inter',
    },
    ...over,
  };
}

function image(over: Partial<ImageElement> = {}): ImageElement {
  return {
    id: 'img1',
    type: 'image',
    x: 0, y: 0, w: 50, h: 50,
    src: 'https://example.test/a.png',
    opacity: 1,
    tintStrength: 0,
    brightness: 0, contrast: 0, saturation: 0, warmth: 0,
    objectFit: 'cover',
    ...over,
  };
}

function build(elements: SlideElement[], assets = emptyAssets()) {
  return buildSlidesPdfDefinition(deck([slide({ elements })]), { assets });
}

/** Every node after the slide's background node. */
function elementNodes(def: { content: PdfNode[] }): PdfNode[] {
  return def.content.slice(1);
}

const svgOf = (node: PdfNode) => String(node.svg ?? '');

// ── Pages ─────────────────────────────────────────────────────────────────────

describe('page layout', () => {
  it('is a 16:9 page with no margins', () => {
    const def = buildSlidesPdfDefinition(deck([slide()]));
    expect(def.pageSize).toEqual({ width: PDF_PAGE_WIDTH, height: PDF_PAGE_HEIGHT });
    expect(PDF_PAGE_WIDTH / PDF_PAGE_HEIGHT).toBeCloseTo(16 / 9, 5);
    expect(def.pageMargins).toEqual([0, 0, 0, 0]);
  });

  it('breaks a page between slides and only between them', () => {
    const def = buildSlidesPdfDefinition(deck([
      slide({ id: 'a' }), slide({ id: 'b' }), slide({ id: 'c' }),
    ]));
    const breaks = def.content.filter((n) => n.pageBreak === 'before');
    expect(breaks).toHaveLength(2);
    // Nothing else advances the cursor, so the break must come first on a page.
    expect(def.content[0].pageBreak).toBeUndefined();
  });

  it('names the document after the presentation', () => {
    const def = buildSlidesPdfDefinition(deck([slide()]), { title: 'Q3 review' });
    expect(def.info).toEqual({ title: 'Q3 review' });
  });
});

// ── Backgrounds ───────────────────────────────────────────────────────────────

describe('slide backgrounds', () => {
  it('paints a colour across the whole page, behind the elements', () => {
    const def = buildSlidesPdfDefinition(deck([
      slide({ background: { type: 'color', value: '#ff0000' }, elements: [text()] }),
    ]));
    const bg = def.content[0];
    expect(bg.canvas).toEqual([
      { type: 'rect', x: 0, y: 0, w: PDF_PAGE_WIDTH, h: PDF_PAGE_HEIGHT, color: '#ff0000' },
    ]);
    // The element comes after it, which is what puts it on top.
    expect(def.content[1].columns).toBeDefined();
  });

  it('falls back to white for a colour PDFKit could not parse', () => {
    const def = buildSlidesPdfDefinition(deck([
      slide({ background: { type: 'color', value: 'rgba(1, 2, 3, 0.5)' } }),
    ]));
    expect((def.content[0].canvas as { color: string }[])[0].color).toBe('#ffffff');
  });

  it('draws a gradient as an SVG with the stops it was written with', () => {
    const def = buildSlidesPdfDefinition(deck([
      slide({ background: { type: 'gradient', value: 'linear-gradient(90deg, #000000 0%, #ffffff 100%)' } }),
    ]));
    const svg = svgOf(def.content[0]);
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('stop-color="#000000"');
    expect(svg).toContain('stop-color="#ffffff"');
    expect(def.content[0].width).toBe(PDF_PAGE_WIDTH);
  });

  it('falls back to the first stop when the gradient is not a linear one', () => {
    const def = buildSlidesPdfDefinition(deck([
      slide({ background: { type: 'gradient', value: 'radial-gradient(#abcdef, #000000)' } }),
    ]));
    expect(def.content[0].svg).toBeUndefined();
    expect((def.content[0].canvas as { color: string }[])[0].color).toBe('#ffffff');
  });

  it('draws a background image only once it has been rasterised', () => {
    const bgSlide = slide({ background: { type: 'image', value: 'neutrino-drive:f1' } });
    const withoutAssets = buildSlidesPdfDefinition(deck([bgSlide]));
    expect(withoutAssets.content[0].canvas).toBeDefined();

    const assets = emptyAssets();
    assets.images.set(backgroundImageKey('s1'), 'data:image/png;base64,AAA');
    const withAssets = buildSlidesPdfDefinition(deck([bgSlide]), { assets });
    expect(withAssets.content[0]).toMatchObject({
      image: 'data:image/png;base64,AAA',
      width: PDF_PAGE_WIDTH,
      height: PDF_PAGE_HEIGHT,
      absolutePosition: { x: 0, y: 0 },
    });
  });
});

// ── Gradient parsing ──────────────────────────────────────────────────────────

describe('parseLinearGradient', () => {
  it('reads the angle and the positioned stops', () => {
    const g = parseLinearGradient('linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)');
    expect(g?.angle).toBe(135);
    expect(g?.stops).toEqual([
      { color: '#0f0c29', offset: 0 },
      { color: '#302b63', offset: 0.5 },
      { color: '#24243e', offset: 1 },
    ]);
  });

  it('spaces unpositioned stops evenly and defaults to "to bottom"', () => {
    const g = parseLinearGradient('linear-gradient(#a1b2c3, #d4e5f6)');
    expect(g?.angle).toBe(180);
    expect(g?.stops.map((s) => s.offset)).toEqual([0, 1]);
  });

  it('understands the side keywords', () => {
    expect(parseLinearGradient('linear-gradient(to right, #000, #fff)')?.angle).toBe(90);
    expect(parseLinearGradient('linear-gradient(to bottom right, #000, #fff)')?.angle).toBe(135);
  });

  it('does not split a colour on its own commas', () => {
    const g = parseLinearGradient('linear-gradient(90deg, rgb(1, 2, 3) 0%, rgb(4, 5, 6) 100%)');
    expect(g?.stops.map((s) => s.color)).toEqual(['rgb(1, 2, 3)', 'rgb(4, 5, 6)']);
  });

  it('rejects anything that is not a linear gradient', () => {
    expect(parseLinearGradient('radial-gradient(#000, #fff)')).toBeNull();
    expect(parseLinearGradient('#ffffff')).toBeNull();
  });

  it('runs the gradient line through the centre in the CSS direction', () => {
    // 90deg points right, so the line spans the width at half height.
    const svg = gradientSvg('linear-gradient(90deg, #000, #fff)', 100, 50) ?? '';
    expect(svg).toContain('x1="0"');
    expect(svg).toContain('x2="100"');
    expect(svg).toContain('y1="25"');
    expect(svg).toContain('y2="25"');
  });
});

// ── Text ──────────────────────────────────────────────────────────────────────

describe('text elements', () => {
  it('places the box by percentage and converts px to points', () => {
    const [node] = elementNodes(build([text()]));
    expect(node.absolutePosition).toEqual({ x: 72, y: 81 });
    expect((node.columns as PdfNode[])[0].width).toBe(360);
    expect(node.fontSize).toBe(30); // 40px × ¾, as the .pptx export converts it
    expect(node).toMatchObject({ bold: true, italics: false, color: '#123456', alignment: 'center' });
  });

  it('wraps the box in a column so it does not wrap against the page', () => {
    const [node] = elementNodes(build([text({ x: 60, w: 30 })]));
    expect(node.columns).toBeDefined();
    expect((node.columns as PdfNode[])[0].width).toBe(216);
  });

  it('carries underline and strikethrough together', () => {
    const [plain] = elementNodes(build([text()]));
    expect(plain.decoration).toBeUndefined();

    const [both] = elementNodes(build([
      text({ style: { ...text().style, underline: true, strikethrough: true } }),
    ]));
    expect(both.decoration).toEqual(['underline', 'lineThrough']);
  });

  it('keeps every line, including the blank ones', () => {
    const [node] = elementNodes(build([text({ content: 'one\n\nthree' })]));
    const stack = (node.columns as PdfNode[])[0].stack as { text: string }[];
    expect(stack.map((l) => l.text)).toEqual(['one', ' ', 'three']);
  });

  it('writes the bullet or the number the canvas shows', () => {
    const bulleted = build([text({ content: 'a\nb', style: { ...text().style, listType: 'bullet' } })]);
    const bullets = (elementNodes(bulleted)[0].columns as PdfNode[])[0].stack as { text: string }[];
    expect(bullets.map((l) => l.text)).toEqual(['•  a', '•  b']);

    const numbered = build([text({ content: 'a\nb', style: { ...text().style, listType: 'numbered' } })]);
    const numbers = (elementNodes(numbered)[0].columns as PdfNode[])[0].stack as { text: string }[];
    expect(numbers.map((l) => l.text)).toEqual(['1.  a', '2.  b']);
  });

  it('spaces paragraphs between the lines only', () => {
    const [node] = elementNodes(build([
      text({ content: 'a\nb', style: { ...text().style, spaceBefore: 8, spaceAfter: 4 } }),
    ]));
    const stack = (node.columns as PdfNode[])[0].stack as { margin: number[] }[];
    expect(stack[0].margin).toEqual([0, 0, 0, 3]);
    expect(stack[1].margin).toEqual([0, 6, 0, 0]);
  });
});

// ── Shapes and lines ──────────────────────────────────────────────────────────

describe('shapes', () => {
  it('stretches the catalog path into the element box', () => {
    const [node] = elementNodes(build([{
      id: 'sh1', type: 'shape', shape: 'rect',
      x: 10, y: 10, w: 20, h: 40,
      fill: '#00ff00', stroke: '#000000', strokeWidth: 4,
    }]));
    expect(node.width).toBe(144);
    expect(node.height).toBe(162);
    const svg = svgOf(node);
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('d="M 0,0 H 100 V 100 H 0 Z"');
    expect(svg).toContain('fill="#00ff00"');
    // The outline must not stretch with the box.
    expect(svg).toContain('vector-effect="non-scaling-stroke"');
    expect(svg).toContain('stroke-width="3"');
  });

  it('leaves out a shape whose kind is not in the catalog', () => {
    const nodes = elementNodes(build([{
      id: 'sh1', type: 'shape', shape: 'not-a-shape',
      x: 0, y: 0, w: 10, h: 10, fill: '#fff', stroke: '', strokeWidth: 1,
    }]));
    expect(nodes).toHaveLength(0);
  });
});

describe('lines', () => {
  const line = {
    id: 'l1', type: 'line' as const,
    x1: 0, y1: 0, x2: 100, y2: 0,
    stroke: '#ff0000', strokeWidth: 2,
  };

  it('draws across the page in page coordinates', () => {
    const [node] = elementNodes(build([line]));
    expect(node.absolutePosition).toEqual({ x: 0, y: 0 });
    const svg = svgOf(node);
    expect(svg).toContain('x1="0"');
    expect(svg).toContain(`x2="${PDF_PAGE_WIDTH}"`);
    expect(svg).toContain('stroke="#ff0000"');
  });

  it('has no arrowheads unless the line asked for them', () => {
    const svg = svgOf(elementNodes(build([line]))[0]);
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('<polyline');
  });

  it('draws each arrowhead with its tip on its own end of the line', () => {
    const svg = svgOf(elementNodes(build([
      { ...line, startArrow: 'triangle' as const, endArrow: 'arrow' as const },
    ]))[0]);
    // A filled head at the start, an open one at the end — and no marker, which
    // is what would need the auto-start-reverse svg-to-pdfkit does not have.
    expect(svg).toContain('<polygon');
    expect(svg).toContain('<polyline');
    expect(svg).not.toContain('<marker');
    expect(svg).toContain('0,0');
    expect(svg).toContain(`${PDF_PAGE_WIDTH},0`);
  });
});

// ── Pictures, diagrams, video, embeds ─────────────────────────────────────────

describe('images', () => {
  it('is drawn from the rasterised asset, keyed by element id', () => {
    const assets = emptyAssets();
    assets.images.set('img1', 'data:image/jpeg;base64,BBB');
    const [node] = elementNodes(build([image()], assets));
    expect(node).toMatchObject({
      image: 'data:image/jpeg;base64,BBB',
      width: 360,
      height: 202.5,
      absolutePosition: { x: 0, y: 0 },
    });
  });

  it('is left off the slide rather than failing the export', () => {
    expect(elementNodes(build([image()]))).toHaveLength(0);
  });

  it('mirrors the canvas filter chain', () => {
    expect(imageFilter(image())).toBe('');
    expect(imageFilter(image({ brightness: 50, contrast: -50, saturation: 100 })))
      .toBe('brightness(1.5) contrast(0.5) saturate(2)');
    expect(imageFilter(image({ warmth: -40 }))).toBe('hue-rotate(-20deg)');
  });
});

describe('diagrams', () => {
  it('is drawn from the SVG prepared for it', () => {
    const assets = emptyAssets();
    assets.diagrams.set('d1', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const [node] = elementNodes(build([
      { id: 'd1', type: 'diagram', x: 0, y: 0, w: 100, h: 100, diagramId: 'x', pageIndex: 0 },
    ], assets));
    expect(node.svg).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(node.width).toBe(PDF_PAGE_WIDTH);
  });
});

describe('video', () => {
  it('becomes a still frame with the URL under it', () => {
    const nodes = elementNodes(build([{
      id: 'v1', type: 'video', x: 0, y: 0, w: 50, h: 50,
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      autoplay: false, loop: false, muted: false,
    }]));
    expect(svgOf(nodes[0])).toContain('fill="#000000"');
    expect(svgOf(nodes[0])).toContain('<polygon');
    const label = (nodes[1].columns as PdfNode[])[0];
    expect(String(label.text)).toContain('youtube.com/embed/abcdefghijk');
  });
});

describe('sheet embeds', () => {
  const embed = {
    id: 'e1', type: 'sheetEmbed' as const,
    x: 0, y: 0, w: 50, h: 50,
    spreadsheetId: 'sp', sheetId: '0', namedRangeId: 'r',
    cachedData: JSON.stringify([['a', 'b'], [1, null]]),
    cachedAt: null, title: null,
  };

  it('sits on a white card, so dark slides do not swallow the values', () => {
    const [card] = elementNodes(build([embed]));
    expect((card.canvas as { color: string }[])[0].color).toBe('#ffffff');
  });

  it('becomes a table of the values the slide had cached', () => {
    const node = elementNodes(build([embed]))[1];
    const table = node.table as { widths: number[]; body: { text: string }[][] };
    expect(table.body).toHaveLength(2);
    expect(table.body[0].map((c) => c.text)).toEqual(['a', 'b']);
    // A missing value is a blank cell, not the string "null".
    expect(table.body[1].map((c) => c.text)).toEqual(['1', '']);
    // Fixed widths, or the table would stretch to the edge of the page.
    expect(table.widths.every((w) => typeof w === 'number')).toBe(true);
  });

  it('titles the embed above the table', () => {
    const nodes = elementNodes(build([{ ...embed, title: 'Revenue' }]));
    expect((nodes[1].columns as PdfNode[])[0].text).toBe('Revenue');
    expect(nodes[2].table).toBeDefined();
  });

  it('draws the empty card and no table for a cache that will not parse', () => {
    for (const cachedData of ['not json', null]) {
      const nodes = elementNodes(build([{ ...embed, cachedData }]));
      expect(nodes).toHaveLength(1);
      expect(nodes[0].table).toBeUndefined();
    }
  });
});

// ── Colours ───────────────────────────────────────────────────────────────────

describe('safeColor', () => {
  it('keeps what PDFKit can parse and replaces what it cannot', () => {
    expect(safeColor('#abc', '#000')).toBe('#abc');
    expect(safeColor('#aabbcc', '#000')).toBe('#aabbcc');
    expect(safeColor('rebeccapurple', '#000')).toBe('rebeccapurple');
    expect(safeColor('rgb(1,2,3)', '#000')).toBe('#000');
    expect(safeColor('', '#000')).toBe('#000');
    expect(safeColor(undefined, '#000')).toBe('#000');
  });
});
