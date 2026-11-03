/**
 * Part of a diagram page, as a page of its own and as a picture.
 *
 * Copying a selection and embedding one both need "the page, but only these
 * shapes" — the copy to draw the PNG, the embed to draw it live — so the filter
 * is one function both go through, and the two cannot disagree about what a
 * selection includes.
 */

import type { DiagramPage } from '../../types';
import { computeViewBox, diagramPageToSvg } from '../diagramSvg';
import { resolveFillImages } from '../utils/fillImages';

/**
 * The page with only `shapeIds` on it.
 *
 * A connector comes along when both its ends are in the selection — one with a
 * loose end would point at a shape that is not in the picture. Freehand strokes
 * are not selectable, so they are left out. An empty or absent list is the
 * whole page, which is what an embed made before selections existed means.
 */
export function selectionPage(page: DiagramPage, shapeIds?: readonly string[] | null): DiagramPage {
  if (!shapeIds || shapeIds.length === 0) return page;
  const keep = new Set(shapeIds);
  return {
    ...page,
    shapes: page.shapes.filter((s) => keep.has(s.id)),
    connectors: page.connectors.filter((c) => c.sourceId !== null && c.targetId !== null && keep.has(c.sourceId) && keep.has(c.targetId)),
    strokes: [],
  };
}

/** The selection's size in diagram units — the picture's natural size. */
export function selectionSize(page: DiagramPage): { width: number; height: number } {
  const [, , width, height] = computeViewBox(page).split(' ').map(Number);
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * A page rendered to PNG at `scale` × its natural size.
 *
 * Drawn from the model through the same SVG writer a save uses, so the picture
 * carries no selection handles, viewport or cursors. Image fills are resolved to
 * data URLs first, since an SVG decoded into an `<img>` may not fetch anything.
 */
export async function pageToPng(page: DiagramPage, scale = 2): Promise<Blob> {
  const { width, height } = selectionSize(page);
  const images = await resolveFillImages(page.shapes);
  const svg = diagramPageToSvg(page, { width, height, background: page.background ?? '#ffffff', images });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
