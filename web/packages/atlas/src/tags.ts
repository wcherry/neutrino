/**
 * The key two strings are compared by, for tags and link resolution: NFC, then Unicode case
 * folding (SPEC §4.4, §7). Upper- then lower-casing is full case folding for everything a title
 * or tag holds in practice (`ß` → `ss`, `ς` → `σ`). Display always keeps the original spelling.
 */
export function matchKey(s: string): string {
  return s.normalize('NFC').toUpperCase().toLowerCase();
}

/** A character a tag may contain (§4.4): letters, marks, decimal digits, `_` and `-`. */
export function isTagScalar(cp: number): boolean {
  if (cp === 0x5f || cp === 0x2d) return true;
  return /^[\p{L}\p{M}\p{Nd}]$/u.test(String.fromCodePoint(cp));
}

/** Whether `name` (without its `#`) is a tag: `/`-separated segments of tag characters, not digits alone. */
export function isValidTag(name: string): boolean {
  const segments = name.split('/');
  if (!segments.every((s) => s !== '' && Array.from(s).every((c) => isTagScalar(c.codePointAt(0)!)))) return false;
  return Array.from(name).some((c) => c !== '/' && !/^\p{Nd}$/u.test(c));
}
