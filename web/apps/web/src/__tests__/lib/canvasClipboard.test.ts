/**
 * A copied Diagrams or Drawing selection on the clipboard.
 *
 * The clip is read back out of HTML that arrives with every paste, from any app,
 * and ends up as node attributes in documents other people open — so most of
 * what is pinned here is what it refuses.
 */

import { describe, it, expect } from 'vitest';
import {
  CANVAS_CLIP_ATTRIBUTE,
  canvasClipHtml,
  embedSize,
  parseCanvasClip,
  readCanvasClip,
  readPastedImage,
  type CanvasClip,
} from '@/lib/canvasClipboard';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const diagramClip: CanvasClip = {
  v: 1, kind: 'diagram', fileId: 'file-1', title: 'Flow <"chart">', pageIndex: 2, shapeIds: ['s1', 's2'], width: 300, height: 150,
};
const drawingClip: CanvasClip = {
  v: 1, kind: 'drawing', fileId: 'file-2', title: 'Logo — draft', selection: { kind: 'objects', layerId: 'l1', ids: ['o1'] }, width: 64, height: 64,
};

/** Enough of a `DataTransfer` for the readers: string flavours and files. */
function transfer(flavours: Record<string, string>, files: File[] = []): DataTransfer {
  return {
    getData: (type: string) => flavours[type] ?? '',
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    files,
  } as unknown as DataTransfer;
}

describe('the clip in pasted HTML', () => {
  it.each([diagramClip, drawingClip])('round-trips a $kind clip, title escaping and non-ASCII included', (clip) => {
    const pasted = readCanvasClip(transfer({ 'text/html': canvasClipHtml(clip, PNG) }));
    expect(pasted).toEqual({ clip, imageSrc: PNG });
  });

  it('is found inside the wrapper HTML a browser adds on the way through the clipboard', () => {
    const html = `<html><body><!--StartFragment-->${canvasClipHtml(diagramClip, PNG)}<!--EndFragment--></body></html>`;
    expect(readCanvasClip(transfer({ 'text/html': html }))?.clip).toEqual(diagramClip);
  });

  it('is absent from ordinary HTML', () => {
    expect(readCanvasClip(transfer({ 'text/html': '<p>Hello</p>' }))).toBeNull();
    expect(readCanvasClip(transfer({ 'text/plain': 'Hello' }))).toBeNull();
  });

  it('is ignored when the picture is not an inline image', () => {
    const html = canvasClipHtml(diagramClip, PNG).replace(PNG, 'https://example.com/x.png');
    expect(readCanvasClip(transfer({ 'text/html': html }))).toBeNull();
  });

  it('is ignored when the attribute is not a clip', () => {
    const html = `<img src="${PNG}" ${CANVAS_CLIP_ATTRIBUTE}="${btoa('{"v":1,"kind":"sheet"}')}">`;
    expect(readCanvasClip(transfer({ 'text/html': html }))).toBeNull();
    expect(readCanvasClip(transfer({ 'text/html': `<img src="${PNG}" ${CANVAS_CLIP_ATTRIBUTE}="not base64!">` }))).toBeNull();
  });
});

describe('parseCanvasClip', () => {
  it('refuses ids that could be anything but an id', () => {
    expect(parseCanvasClip({ ...diagramClip, fileId: '../etc' })).toBeNull();
    expect(parseCanvasClip({ ...diagramClip, shapeIds: ['ok', 'no spaces'] })).toBeNull();
    expect(parseCanvasClip({ ...drawingClip, selection: { kind: 'objects', layerId: '<x>', ids: ['o1'] } })).toBeNull();
  });

  it('refuses an empty selection, which would embed nothing', () => {
    expect(parseCanvasClip({ ...diagramClip, shapeIds: [] })).toBeNull();
    expect(parseCanvasClip({ ...drawingClip, selection: { kind: 'nodes', ids: [] } })).toBeNull();
  });

  it('refuses sizes that are not a picture', () => {
    expect(parseCanvasClip({ ...diagramClip, width: 0 })).toBeNull();
    expect(parseCanvasClip({ ...diagramClip, height: Number.NaN })).toBeNull();
  });

  it('refuses another version, and drops fields it does not know', () => {
    expect(parseCanvasClip({ ...diagramClip, v: 2 })).toBeNull();
    expect(parseCanvasClip({ ...diagramClip, extra: 'x' })).toEqual(diagramClip);
  });

  it('truncates a long title rather than refusing the paste', () => {
    expect((parseCanvasClip({ ...diagramClip, title: 'x'.repeat(500) }) as CanvasClip).title).toHaveLength(200);
  });
});

describe('readPastedImage', () => {
  const screenshot = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });

  it('takes a lone picture — a screenshot', () => {
    expect(readPastedImage(transfer({}, [screenshot]))).toBe(screenshot);
  });

  it('takes "Copy image" from a browser, which brings an <img> and nothing else', () => {
    expect(readPastedImage(transfer({ 'text/html': '<img src="https://example.com/cat.png">' }, [screenshot]))).toBe(screenshot);
  });

  it('leaves a picture that came with text to the editor, which keeps the text', () => {
    expect(readPastedImage(transfer({ 'text/html': '<p>Caption</p><img src="x.png">' }, [screenshot]))).toBeNull();
  });

  it('ignores files that are not pictures', () => {
    expect(readPastedImage(transfer({}, [new File(['a'], 'a.txt', { type: 'text/plain' })]))).toBeNull();
  });
});

describe('embedSize', () => {
  it('keeps a small picture at its own size', () => {
    expect(embedSize(drawingClip, 640)).toEqual({ width: 64, height: 64 });
  });

  it('scales a wide one down to the limit and keeps its shape', () => {
    expect(embedSize({ ...diagramClip, width: 1280, height: 640 }, 640)).toEqual({ width: 640, height: 320 });
  });
});
