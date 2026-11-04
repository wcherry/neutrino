/**
 * Drawing a document's preview — the picture Drive's grid shows for it.
 *
 * Every editor's content is end-to-end encrypted, so the server cannot draw a
 * preview itself: the editor that holds the plaintext renders its first page
 * and stores it with `driveSetThumbnail`. These are the two ways an editor gets
 * from what it has to the JPEG that is stored — rasterising part of its own DOM
 * (Docs, Sheets, Slides, Notes), or shrinking a picture it can already paint
 * (Drawing, Diagrams).
 *
 * `useDocumentPreview` decides *when*; this file only knows *how*.
 */

/** The longest edge of a stored preview, in pixels — the size uploads use too. */
export const PREVIEW_MAX_EDGE = 512;

/** Small enough to keep a preview in the tens of kilobytes, sharp enough for a tile. */
const PREVIEW_JPEG_QUALITY = 0.82;

/**
 * Scale `source` down so its longer edge is at most `PREVIEW_MAX_EDGE`, flatten
 * it onto `background` (a JPEG has no alpha, and a transparent drawing would
 * otherwise come out black) and encode it as a JPEG.
 */
export async function toPreviewJpeg(
  source: CanvasImageSource & { width: number; height: number },
  background = '#ffffff',
): Promise<Blob | null> {
  const { width, height } = source;
  if (!width || !height) return null;
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', PREVIEW_JPEG_QUALITY));
}

/** `toPreviewJpeg` for an image an editor already encoded, such as Drawing's PNG thumbnail. */
export async function blobToPreviewJpeg(image: Blob, background = '#ffffff'): Promise<Blob | null> {
  const bitmap = await createImageBitmap(image);
  try {
    return await toPreviewJpeg(bitmap, background);
  } finally {
    bitmap.close();
  }
}

export interface ElementPreviewOptions {
  /**
   * The region to keep, from the element's top-left, in CSS pixels. Defaults
   * to the whole element; Docs passes one page's height so a long document is
   * not rasterised in full to keep its top.
   */
  width?: number;
  height?: number;
  background?: string;
  /**
   * Inline styles applied to the cloned root only — for undoing what the
   * editor does to the live element for the screen, such as a zoom transform.
   */
  style?: Partial<CSSStyleDeclaration>;
}

/** Other people's carets and name tags, and anything an editor marks as chrome. */
const PREVIEW_EXCLUDED = '[data-preview-exclude], .collaboration-cursor__caret, .collaboration-cursor__label';

/**
 * Rasterise `element` (or its top-left `width` × `height`) into a preview.
 *
 * Rendered at whatever pixel ratio lands the longer edge on `PREVIEW_MAX_EDGE`
 * rather than at the screen's: a Letter page is drawn below 1×, so a 4K display
 * does not pay to draw it at four times the size it is about to be shrunk to,
 * and Slides' 160px rail thumbnail is drawn above it, so it is not blurry.
 */
export async function renderElementPreview(
  element: HTMLElement,
  options: ElementPreviewOptions = {},
): Promise<Blob | null> {
  const width = Math.round(options.width ?? element.scrollWidth);
  const height = Math.round(options.height ?? element.scrollHeight);
  if (!width || !height) return null;
  const background = options.background ?? '#ffffff';
  // Loaded here rather than at the top of the file: this runs when the browser
  // is idle, and every editor imports this module, so a static import would put
  // the library in each editor's first-load JS (route-budgets.json), including
  // Drawing's and Diagrams', which never rasterise their DOM.
  const { toCanvas } = await import('html-to-image');
  const canvas = await toCanvas(element, {
    width,
    height,
    canvasWidth: width,
    canvasHeight: height,
    pixelRatio: PREVIEW_MAX_EDGE / Math.max(width, height),
    backgroundColor: background,
    style: options.style,
    // Web fonts are re-fetched and inlined unless told otherwise; a preview
    // that falls back to a system face is fine, a slow autosave is not.
    skipFonts: true,
    // Cursors, selection handles, collaborators' carets: chrome, not content.
    filter: (node) => !(node instanceof Element && node.matches(PREVIEW_EXCLUDED)),
  });
  return toPreviewJpeg(canvas, background);
}
