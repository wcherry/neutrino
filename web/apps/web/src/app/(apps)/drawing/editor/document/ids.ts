/**
 * Stable identifiers for everything in a drawing.
 *
 * Redesign §1 asks for a UUID on every object, and the reason is not tidiness:
 * ids are what a mask's `maskFor`, a reusable object's reference and an
 * OpenRaster asset filename all point at, and the old model's
 * `Math.random().toString(36).slice(2, 10)` is eight characters of base-36 —
 * about 40 bits, which collides inside a single large drawing often enough to
 * matter and offers no guarantee at all across two drawings pasted together.
 */

/**
 * A v4 UUID.
 *
 * `crypto.randomUUID` is unavailable on an insecure origin in some browsers, so
 * there is a `getRandomValues` fallback that builds the same thing by hand. The
 * last resort is `Math.random`, which is reached only where neither exists and
 * is still wider than what it replaced.
 */
export function newId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Version 4, variant 1.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-` +
    `${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  );
}

/**
 * An id safe to use as a filename inside the `.ora` archive.
 *
 * A UUID already is, but a document that has been through another application
 * may carry an id with a slash or a colon in it, and one of those in a zip
 * entry name is a path traversal rather than a layer.
 */
export function assetSafeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}
