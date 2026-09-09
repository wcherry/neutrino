/**
 * Resolving the images a page uses as shape fills.
 *
 * These come back as **data URLs**, not the object URLs the rest of the app
 * prefers for live `<img>` elements, because a diagram leaves the editor by
 * being serialised: every export loads the SVG through `new Image()`, and a PDF
 * takes the markup on its own. An SVG in either of those may not fetch external
 * resources, so an object URL or a Drive download URL renders as a hole in
 * every PNG, JPEG, SVG and PDF. Base64 in the DOM is what that costs, and a
 * diagram carries a handful of fills rather than the hundreds of images a
 * document can.
 */

import { parseDriveImageRef, resolveDriveImageDataUrl } from '@/lib/driveImages';
import type { DiagramShape } from '../../types';
import { collectFillImages } from './shapeFill';

const dataUrls = new Map<string, Promise<string>>();

/** One image fill, resolved and cached for the session. */
export function resolveFillImage(value: string): Promise<string> {
  let pending = dataUrls.get(value);
  if (!pending) {
    const fileId = parseDriveImageRef(value);
    pending = (fileId ? resolveDriveImageDataUrl(fileId) : Promise.resolve(value)).catch((e) => {
      // Never cache a failure: an image that failed while the encryption keys
      // were locked has to resolve on the next attempt.
      dataUrls.delete(value);
      throw e;
    });
    dataUrls.set(value, pending);
  }
  return pending;
}

/**
 * Every image fill on the page, keyed by the value stored on the shape.
 *
 * One that cannot be resolved is left out rather than failing the batch — the
 * shape falls back to its colour, which is the whole point of `style.fill`
 * surviving beside `fillStyle`.
 */
export async function resolveFillImages(
  shapes: DiagramShape[],
): Promise<ReadonlyMap<string, string>> {
  const entries = await Promise.all(
    collectFillImages(shapes).map(async (value) => {
      try {
        return [value, await resolveFillImage(value)] as const;
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is readonly [string, string] => e !== null));
}
