const PUNCTUATION_RE = /[^\p{L}\p{N}\s]/gu;

export function normalizeText(text: string): string[] {
  const normalized = text
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCTUATION_RE, ' ');
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return [...new Set(tokens)];
}

export async function hashToken(token: string, searchKey: Uint8Array): Promise<string> {
  const keyMaterial = new Uint8Array(searchKey) as Uint8Array<ArrayBuffer>;
  const key = await crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function tokenize(text: string, searchKey: Uint8Array): Promise<string[]> {
  const tokens = normalizeText(text);
  return Promise.all(tokens.map((t) => hashToken(t, searchKey)));
}

export interface TokenWithPositions {
  hash: string;
  positions: number[];
}

export async function tokenizeWithPositions(
  text: string,
  searchKey: Uint8Array,
): Promise<TokenWithPositions[]> {
  const normalized = text
    .normalize('NFC')
    .toLowerCase()
    .replace(PUNCTUATION_RE, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);

  const positionMap = new Map<string, number[]>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const existing = positionMap.get(w);
    if (existing) {
      existing.push(i);
    } else {
      positionMap.set(w, [i]);
    }
  }

  const results: TokenWithPositions[] = [];
  for (const [token, positions] of positionMap) {
    const hash = await hashToken(token, searchKey);
    results.push({ hash, positions });
  }
  return results;
}
