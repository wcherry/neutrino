/**
 * The second format a diagram is stored in: a plain `.svg` carrying the diagram
 * inside it.
 *
 * The whole reason the format exists is that it round-trips — an SVG that is a
 * picture and nothing else would have been a one-way export, which the Export
 * dialog already had. So these pin down that a document survives the trip out
 * and back unchanged, that the payload cannot be broken by whatever someone
 * typed into a label, and that an SVG written by anything *else* is recognised
 * as such rather than opened as an empty diagram over the top of it.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@neutrino/api-diagrams', async () => {
  // Only `diagramsApi` is mocked away — the format helpers under test live in
  // this package and are the thing being exercised.
  const actual = await vi.importActual<typeof import('@neutrino/api-diagrams')>(
    '@neutrino/api-diagrams',
  );
  return { ...actual, diagramsApi: { getDiagram: vi.fn() } };
});

import {
  embedDiagramSource,
  extractDiagramSource,
  looksLikeSvgBody,
  extractDiagramText,
  diagramFormatForMime,
  DIAGRAM_MIME_TYPE,
  DIAGRAM_SVG_MIME_TYPE,
} from '@neutrino/api-diagrams';
import {
  diagramDocumentToSvg,
  parseSvgDiagram,
  svgAsImageDocument,
  svgDataUrl,
  svgToDiagramDocument,
  svgPictureIndex,
  type SvgBackedDocument,
} from '@/app/(apps)/diagrams/editor/io/svgFormat';
import { parseImport } from '@/app/(apps)/diagrams/editor/io/importUtils';
import type { DiagramDocument, DiagramShape } from '@/app/(apps)/diagrams/types';

function shape(over: Partial<DiagramShape> = {}): DiagramShape {
  return {
    id: 'sh1',
    type: 'rectangle',
    x: 10, y: 20, width: 100, height: 50,
    label: 'Start',
    style: {
      fill: '#ffffff', stroke: '#000000', strokeWidth: 1, opacity: 1,
      fontSize: 12, fontFamily: 'Inter', textColor: '#111111',
    },
    ...over,
  } as DiagramShape;
}

function doc(over: Partial<DiagramDocument> = {}): DiagramDocument {
  return {
    version: 1,
    pages: [{ id: 'p1', name: 'Page 1', shapes: [shape()], connectors: [] }],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...over,
  } as DiagramDocument;
}

describe('the SVG container', () => {
  it('puts the source inside a valid SVG and gets it back out', () => {
    const svg = embedDiagramSource('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', '{"a":1}');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<rect/>');
    expect(extractDiagramSource(svg)).toBe('{"a":1}');
  });

  it('replaces the payload instead of stacking a new one beside it', () => {
    const once = embedDiagramSource('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'first');
    const twice = embedDiagramSource(once, 'second');
    expect(extractDiagramSource(twice)).toBe('second');
    expect(twice.match(/<metadata/g)).toHaveLength(1);
  });

  it('survives a source full of the characters that would end the element', () => {
    const source = JSON.stringify({ label: '</metadata><script>alert(1)</script> & "quoted" <>' });
    const svg = embedDiagramSource('<svg xmlns="http://www.w3.org/2000/svg"></svg>', source);
    expect(svg).not.toContain('<script>');
    expect(extractDiagramSource(svg)).toBe(source);
  });

  it('carries non-ASCII through unchanged', () => {
    const source = JSON.stringify({ label: 'Café → 図 🙂' });
    const svg = embedDiagramSource('<svg xmlns="http://www.w3.org/2000/svg"></svg>', source);
    expect(extractDiagramSource(svg)).toBe(source);
  });

  it('reports no source for an SVG that carries none', () => {
    expect(extractDiagramSource('<svg xmlns="http://www.w3.org/2000/svg"><circle/></svg>')).toBeNull();
  });

  it('leaves something that is not an SVG alone rather than producing invalid markup', () => {
    expect(embedDiagramSource('not markup', 'x')).toBe('not markup');
  });
});

describe('looksLikeSvgBody', () => {
  it('accepts an SVG behind an XML declaration or a doctype', () => {
    expect(looksLikeSvgBody('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(true);
    expect(looksLikeSvgBody('<?xml version="1.0"?>\n<svg/>')).toBe(true);
    expect(looksLikeSvgBody('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg/>')).toBe(true);
  });

  it('rejects the other bodies a diagram file could hold', () => {
    expect(looksLikeSvgBody('{"pages":[]}')).toBe(false);
    expect(looksLikeSvgBody('<mxfile><diagram/></mxfile>')).toBe(false);
    expect(looksLikeSvgBody('')).toBe(false);
  });
});

describe('diagramDocumentToSvg', () => {
  it('round-trips a document unchanged', () => {
    const original = doc();
    const restored = parseSvgDiagram(diagramDocumentToSvg(original));
    expect(restored).toEqual({ ...original, svgPageIndex: 0 });
  });

  it('draws the page as a real picture beside the payload', () => {
    const svg = diagramDocumentToSvg(doc());
    expect(svg).toContain('<path d="M 10 20 H 110 V 70 H 10 Z"');
    expect(svg).toContain('Start');
  });

  it('sizes the file to the content rather than to a fixed box', () => {
    // The shape box is 100×50 and `computeViewBox` pads it by 20 on each side.
    const svg = diagramDocumentToSvg(doc());
    expect(svg).toContain('width="140"');
    expect(svg).toContain('height="90"');
  });

  it('shows the recorded page and keeps every page in the source', () => {
    const twoPages = doc({
      pages: [
        { id: 'p1', name: 'One', shapes: [shape({ label: 'first' })], connectors: [] },
        { id: 'p2', name: 'Two', shapes: [shape({ id: 'sh2', label: 'second' })], connectors: [] },
      ],
    }) as SvgBackedDocument;
    twoPages.svgPageIndex = 1;

    const svg = diagramDocumentToSvg(twoPages);
    expect(svg).toContain('second');
    expect(svg).not.toContain('>first<');
    expect(parseSvgDiagram(svg)!.pages).toHaveLength(2);
  });

  it('stays a valid, reopenable file when the document has no pages at all', () => {
    const empty = doc({ pages: [] });
    const svg = diagramDocumentToSvg(empty);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(parseSvgDiagram(svg)!.pages).toEqual([]);
  });
});

describe('svgPictureIndex', () => {
  it('defaults to the first page and clamps anything out of range', () => {
    const twoPages = doc({
      pages: [
        { id: 'p1', name: 'One', shapes: [], connectors: [] },
        { id: 'p2', name: 'Two', shapes: [], connectors: [] },
      ],
    }) as SvgBackedDocument;
    expect(svgPictureIndex(twoPages)).toBe(0);
    expect(svgPictureIndex({ ...twoPages, svgPageIndex: 1 })).toBe(1);
    // A page index left behind by a page that has since been deleted.
    expect(svgPictureIndex({ ...twoPages, svgPageIndex: 9 })).toBe(1);
    expect(svgPictureIndex({ ...twoPages, svgPageIndex: -1 })).toBe(0);
  });
});

describe('an SVG from somewhere else', () => {
  const foreign = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><circle r="5"/></svg>';

  it('is not mistaken for a diagram', () => {
    expect(parseSvgDiagram(foreign)).toBeNull();
  });

  it('comes in as its own picture on a page, at its declared size', () => {
    const imported = svgAsImageDocument(foreign);
    expect(imported.pages).toHaveLength(1);
    const [only] = imported.pages[0].shapes;
    expect(only.type).toBe('drawio-image');
    expect(only.width).toBe(640);
    expect(only.height).toBe(480);
    expect(String(only.data?.imageUrl)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('falls back to the viewBox when it declares no width or height', () => {
    const [only] = svgAsImageDocument(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect/></svg>',
    ).pages[0].shapes;
    expect(only.width).toBe(300);
    expect(only.height).toBe(150);
  });

  it('is scaled down rather than dropped on the canvas at poster size', () => {
    const [only] = svgAsImageDocument(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="2000"/>',
    ).pages[0].shapes;
    expect(only.width).toBe(1200);
    expect(only.height).toBe(600);
  });

  it('is shown as an image, so script inside it cannot run in this origin', () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const url = svgDataUrl(hostile);
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(url).not.toContain('<script>');
  });
});

describe('svgToDiagramDocument', () => {
  it('prefers the embedded diagram over the picture', () => {
    const original = doc();
    const restored = svgToDiagramDocument(diagramDocumentToSvg(original));
    expect(restored.pages[0].shapes[0].label).toBe('Start');
    expect(restored.pages[0].shapes[0].type).toBe('rectangle');
  });
});

describe('parseImport', () => {
  it('reads an SVG as a document rather than handing it to the drawio parser', () => {
    // Both open with `<`, and drawio's parser finds no `mxCell` in an SVG — so
    // getting this order wrong is a silently empty import, not an error.
    const result = parseImport(diagramDocumentToSvg(doc()));
    expect(result.kind).toBe('document');
    if (result.kind !== 'document') throw new Error('unreachable');
    expect(result.document.pages[0].shapes[0].label).toBe('Start');
  });

  it('still reads drawio XML, Neutrino JSON and Mermaid', () => {
    expect(parseImport('{"version":1,"pages":[],"viewport":{"x":0,"y":0,"zoom":1}}').kind)
      .toBe('document');
    expect(parseImport('<mxfile><mxCell vertex="1" value="A"/></mxfile>').kind).toBe('document');
    expect(parseImport('flowchart TD\nA[One] --> B[Two]').kind).toBe('elements');
  });

  it('takes .mmd and .md at their word, since Mermaid has nothing to sniff for', () => {
    expect(parseImport('A[One] --> B[Two]', 'mmd').kind).toBe('elements');
    expect(parseImport('A[One] --> B[Two]', 'MD').kind).toBe('elements');
  });
});

describe('extractDiagramText', () => {
  it('indexes an SVG-stored diagram off its source, not off the picture', () => {
    const twoPages = doc({
      pages: [
        { id: 'p1', name: 'One', shapes: [shape({ label: 'drawn' })], connectors: [] },
        { id: 'p2', name: 'Two', shapes: [shape({ id: 'sh2', label: 'hidden' })], connectors: [] },
      ],
    });
    const text = extractDiagramText(diagramDocumentToSvg(twoPages));
    // The second page is nowhere in the picture, and search still finds it.
    expect(text).toContain('drawn');
    expect(text).toContain('hidden');
    expect(text).toContain('Two');
  });

  it('still reads the native JSON body', () => {
    expect(extractDiagramText(JSON.stringify(doc()))).toContain('Start');
  });

  it('has nothing to say about an SVG that is not a diagram', () => {
    expect(extractDiagramText('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>')).toBe('');
  });
});

describe('diagramFormatForMime', () => {
  it('names the two stored formats and nothing else', () => {
    expect(diagramFormatForMime(DIAGRAM_MIME_TYPE)).toBe('diagram');
    expect(diagramFormatForMime(DIAGRAM_SVG_MIME_TYPE)).toBe('svg');
    expect(diagramFormatForMime('image/png')).toBeNull();
    expect(diagramFormatForMime(null)).toBeNull();
  });
});
