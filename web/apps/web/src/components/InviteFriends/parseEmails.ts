/** Separators people use between addresses: commas, semicolons and any whitespace. */
export const EMAIL_SEPARATORS = /[,;\s]+/;

// Something before the @, and a domain with at least one dot. Deliberately loose:
// the server is the judge, this only catches typos before they become chips.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isEmail(text: string): boolean {
  return EMAIL.test(text);
}

/**
 * Split typed or pasted text into addresses the server will take (trimmed,
 * lower-cased, de-duplicated in first-seen order) and the leftovers it will not
 * (as typed).
 */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(EMAIL_SEPARATORS)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!isEmail(trimmed)) {
      invalid.push(trimmed);
      continue;
    }
    const address = trimmed.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    valid.push(address);
  }
  return { valid, invalid };
}
