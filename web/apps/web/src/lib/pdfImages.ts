/**
 * Image normalisation for the PDF export.
 *
 * pdfmake embeds image bytes verbatim and sniffs the format from the first
 * bytes: JPEG (`FF D8`) and PNG (`\x89PNG`) are the only two it understands,
 * and anything else throws `Unknown image format.` out of `PDFDocument.open`,
 * which fails the *whole* export rather than the one picture. A document can
 * easily hold something else — a pasted WebP screenshot, a GIF, an inline SVG,
 * an AVIF photo — so every image is re-encoded through a canvas on the way out
 * and the ones that cannot be decoded at all are dropped.
 *
 * This runs after `inlineDriveImagesInHtml`, so a `neutrino-drive:` src that
 * reaches here is one whose bytes could not be fetched; it can never be
 * embedded and is dropped like any other undecodable image.
 */

/** Formats pdfmake can embed as-is — no point paying to re-encode these. */
const PDF_NATIVE_SRC = /^data:image\/(png|jpe?g);base64,/i;

/** JPEG quality used when re-encoding an image that has no transparency. */
const JPEG_QUALITY = 0.92;

export interface NormalizedHtml {
  /** The HTML with every image src replaced by PNG/JPEG bytes. */
  html: string;
  /** The srcs of images that could not be embedded and were removed. */
  dropped: string[];
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // A remote image has to be fetched with CORS or the canvas is tainted and
    // toDataURL() throws; data: URLs are same-origin and need no such thing.
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded.'));
    img.src = src;
  });
}

/** True if any pixel is not fully opaque — decides PNG vs the smaller JPEG. */
export function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) return true;
    }
    return false;
  } catch {
    // Tainted canvas, or getImageData unavailable: assume transparency so the
    // re-encode keeps an alpha channel rather than flattening it onto black.
    return true;
  }
}

/** Re-encodes any image the browser can decode into PNG or JPEG bytes. */
async function reEncode(src: string): Promise<string> {
  const img = await loadImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  // An SVG with no intrinsic size decodes but has nothing to rasterise from.
  if (!w || !h) throw new Error('The image has no intrinsic size.');

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas rendering is unavailable.');
  ctx.drawImage(img, 0, 0);

  if (hasTransparency(ctx, w, h)) return canvas.toDataURL('image/png');
  // Opaque photos (WebP/AVIF especially) balloon as PNG, so flatten onto white
  // and keep them as JPEG instead.
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

/**
 * Rewrites every `<img>` in a fragment of HTML into bytes pdfmake can embed,
 * removing the ones it cannot. Identical srcs are only converted once.
 */
export async function normalizeImagesForPdf(html: string): Promise<NormalizedHtml> {
  const div = document.createElement('div');
  div.innerHTML = html;
  const images = Array.from(div.querySelectorAll('img'));
  if (images.length === 0) return { html, dropped: [] };

  const cache = new Map<string, Promise<string>>();
  const dropped: string[] = [];

  await Promise.all(
    images.map(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (PDF_NATIVE_SRC.test(src)) return;
      if (!src) {
        img.remove();
        return;
      }
      let converted = cache.get(src);
      if (!converted) {
        converted = reEncode(src);
        cache.set(src, converted);
      }
      try {
        img.setAttribute('src', await converted);
      } catch {
        // One unembeddable picture must not cost the user the export.
        img.remove();
        dropped.push(src);
      }
    }),
  );

  return { html: div.innerHTML, dropped: [...new Set(dropped)] };
}
