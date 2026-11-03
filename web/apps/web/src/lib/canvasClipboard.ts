/**
 * A selection from Diagrams or Drawing, on the system clipboard.
 *
 * A copy writes two things: the selection as a **PNG**, which any app on the
 * computer can paste as a picture, and a **clip** — which file it came from and
 * what was selected — which is how Docs and Slides offer to paste it as a live
 * embed of that file instead.
 *
 * The clip rides inside the `text/html` flavour, as an attribute on the `<img>`
 * that also carries the picture, rather than under a private mime type. The
 * async clipboard API only writes `text/plain`, `text/html` and `image/png`
 * everywhere; Chrome's `web …` custom formats exist, but a paste *event* does
 * not expose them, and a paste event is what an editor gets. An app that does
 * not know the attribute sees an ordinary image in the HTML and pastes that.
 *
 * Nothing here is the file's content: the PNG is what the user chose to copy,
 * and the clip is an id and a title. Pasting it live still goes through the
 * file's own permissions and key, so a clip is useless to someone without
 * access to the file.
 */

/** The `<img>` attribute that carries the clip, base64-encoded JSON. */
export const CANVAS_CLIP_ATTRIBUTE = 'data-neutrino-clip';

/** What was selected in a drawing — the editor's own selection, minus null. */
export type DrawingClipSelection =
  | { kind: 'objects'; layerId: string; ids: string[] }
  | { kind: 'nodes'; ids: string[] };

export type CanvasClip =
  | {
      v: 1;
      kind: 'diagram';
      fileId: string;
      title: string;
      pageIndex: number;
      /** The shapes copied; connectors between two of them come along. */
      shapeIds: string[];
      /** The picture's size in CSS pixels, which a live embed starts at. */
      width: number;
      height: number;
    }
  | {
      v: 1;
      kind: 'drawing';
      fileId: string;
      title: string;
      selection: DrawingClipSelection;
      width: number;
      height: number;
    };

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_TITLE = 200;
const MAX_IDS = 10_000;

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_IDS && value.every((id) => typeof id === 'string' && ID.test(id));
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000;
}

/**
 * A clip from untrusted input, or null.
 *
 * A clipboard is written by whatever the user last copied from, so the clip is
 * validated field by field rather than trusted for having the right attribute
 * name — it ends up as a node attribute in a document other people open.
 */
export function parseCanvasClip(value: unknown): CanvasClip | null {
  if (typeof value !== 'object' || value === null) return null;
  const c = value as Record<string, unknown>;
  if (c.v !== 1 || typeof c.fileId !== 'string' || !ID.test(c.fileId)) return null;
  if (!isDimension(c.width) || !isDimension(c.height)) return null;
  const title = typeof c.title === 'string' ? c.title.slice(0, MAX_TITLE) : '';

  if (c.kind === 'diagram') {
    const pageIndex = typeof c.pageIndex === 'number' && Number.isInteger(c.pageIndex) && c.pageIndex >= 0 ? c.pageIndex : null;
    if (pageIndex === null || !isIdList(c.shapeIds) || c.shapeIds.length === 0) return null;
    return { v: 1, kind: 'diagram', fileId: c.fileId, title, pageIndex, shapeIds: c.shapeIds, width: c.width, height: c.height };
  }

  if (c.kind === 'drawing') {
    const s = c.selection as Record<string, unknown> | null;
    if (typeof s !== 'object' || s === null || !isIdList(s.ids) || s.ids.length === 0) return null;
    let selection: DrawingClipSelection;
    if (s.kind === 'nodes') selection = { kind: 'nodes', ids: s.ids };
    else if (s.kind === 'objects' && typeof s.layerId === 'string' && ID.test(s.layerId)) {
      selection = { kind: 'objects', layerId: s.layerId, ids: s.ids };
    } else return null;
    return { v: 1, kind: 'drawing', fileId: c.fileId, title, selection, width: c.width, height: c.height };
  }

  return null;
}

function encodeClip(clip: CanvasClip): string {
  const bytes = new TextEncoder().encode(JSON.stringify(clip));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function decodeClip(encoded: string): CanvasClip | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return parseCanvasClip(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The `text/html` flavour: the picture, with the clip on it. */
export function canvasClipHtml(clip: CanvasClip, pngDataUrl: string): string {
  return (
    `<img src="${escapeAttribute(pngDataUrl)}" alt="${escapeAttribute(clip.title)}"` +
    ` width="${Math.round(clip.width)}" height="${Math.round(clip.height)}"` +
    ` ${CANVAS_CLIP_ATTRIBUTE}="${encodeClip(clip)}">`
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Puts a selection on the system clipboard.
 *
 * Must be called **synchronously from the user's gesture** (the Copy command or
 * menu click), which is why the picture is a promise: the clipboard is claimed
 * now, while the browser still counts the call as user-initiated, and the PNG is
 * rendered into it after. Awaiting the render first would lose the gesture in
 * Safari and the write would be refused.
 */
export function writeCanvasClip(clip: CanvasClip, png: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.reject(new Error('This browser cannot copy pictures to the clipboard.'));
  }
  const html = png.then(async (blob) => new Blob([canvasClipHtml(clip, await blobToDataUrl(blob))], { type: 'text/html' }));
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png, 'text/html': html })]);
}

/** A picture on the clipboard with no clip — what a cut writes. Same gesture rule as above. */
export function writeClipboardImage(png: Promise<Blob>): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.reject(new Error('This browser cannot copy pictures to the clipboard.'));
  }
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

// ── Reading a paste ──────────────────────────────────────────────────────────

/** A clip found in a paste, with the picture that came with it. */
export interface PastedCanvasClip {
  clip: CanvasClip;
  /** The PNG as a data URL, for "Paste as picture". */
  imageSrc: string;
}

/** The clip in a paste's HTML, or null when it carries none. */
export function readCanvasClip(data: DataTransfer): PastedCanvasClip | null {
  const html = data.getData('text/html');
  if (!html || !html.includes(CANVAS_CLIP_ATTRIBUTE)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const img = doc.querySelector(`img[${CANVAS_CLIP_ATTRIBUTE}]`);
  const encoded = img?.getAttribute(CANVAS_CLIP_ATTRIBUTE);
  const src = img?.getAttribute('src') ?? '';
  if (!encoded || !src.startsWith('data:image/')) return null;
  const clip = decodeClip(encoded);
  return clip ? { clip, imageSrc: src } : null;
}

/**
 * The image a paste is *only* — a screenshot, or "Copy image" from a browser —
 * or null.
 *
 * An image that arrives beside HTML with text in it is part of a larger copy
 * (a web page, a Word document), and the editor's own paste keeps the text and
 * layout that a lone picture would throw away; so that case is left alone.
 */
export function readPastedImage(data: DataTransfer): File | null {
  let file: File | null = null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      file = item.getAsFile();
      if (file) break;
    }
  }
  if (!file) file = Array.from(data.files ?? []).find((f) => f.type.startsWith('image/')) ?? null;
  if (!file) return null;

  const html = data.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if ((doc.body.textContent ?? '').trim() !== '') return null;
  }
  return file;
}

/** A pasted data URL as a `File`, for uploading "Paste as picture" like any other image. */
export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

/** A file name for a pasted picture of a selection. */
export function clipImageName(clip: CanvasClip): string {
  const base = (clip.title || (clip.kind === 'diagram' ? 'Diagram' : 'Drawing')).replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `${base || 'Pasted'}.png`;
}

/**
 * The size a live embed of `clip` starts at: the copied picture's own size,
 * scaled down to `maxWidth` and never up, keeping its shape.
 */
export function embedSize(clip: CanvasClip, maxWidth: number): { width: number; height: number } {
  const scale = Math.min(1, maxWidth / clip.width);
  return { width: Math.max(1, Math.round(clip.width * scale)), height: Math.max(1, Math.round(clip.height * scale)) };
}
