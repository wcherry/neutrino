/**
 * Full-text search as AtlasKit's index does it with SQLite FTS5, in memory: the same tokenizer
 * (`unicode61 remove_diacritics 2`), the same matching (prefix terms, phrases, AND, NOT, a
 * column filter), the same ranking (`bm25(10.0, 5.0, 1.0)`, ties by rowid) and the same
 * `snippet()`. Ported from SQLite's `fts5_tokenize.c`, `fts5_unicode2.c` and `fts5_aux.c` so a
 * search on the web finds and orders pages as the Mac does.
 *
 * Offsets are UTF-16 indices where SQLite's are UTF-8 bytes; both only ever slice the text.
 * Token characters are judged by SQLite's own Unicode tables (`fts5TokenChars.ts`), not the
 * browser's: they disagree on many emoji, which SQLite indexes as words or skips by its tables.
 */
import { TOKEN_CHAR_RANGES } from './fts5TokenChars';

// ── Tokenizer ─────────────────────────────────────────────────────────────────

export interface Token {
  /** Folded: lower case, diacritics removed. */
  text: string;
  start: number;
  end: number;
}

function isAsciiTokenChar(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

function isTokenChar(c: number): boolean {
  if (c < 0x80) return isAsciiTokenChar(c);
  let lo = 0;
  let hi = TOKEN_CHAR_RANGES.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c < TOKEN_CHAR_RANGES[mid * 2]) hi = mid - 1;
    else if (c > TOKEN_CHAR_RANGES[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The `unicode61` tokenizer with `remove_diacritics 2`. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    // Skip separators. A diacritic can continue a token but not start one.
    let c = text.codePointAt(i)!;
    if (!isTokenChar(c)) {
      i += c > 0xffff ? 2 : 1;
      continue;
    }
    const start = i;
    let folded = '';
    while (i < text.length) {
      c = text.codePointAt(i)!;
      if (c < 0x80) {
        if (!isAsciiTokenChar(c)) break;
        folded += String.fromCharCode(c >= 0x41 && c <= 0x5a ? c + 32 : c);
      } else {
        if (!isTokenChar(c) && !isDiacritic(c)) break;
        const f = fold(c);
        if (f) folded += String.fromCodePoint(f);
      }
      i += c > 0xffff ? 2 : 1;
    }
    tokens.push({ text: folded, start, end: i });
  }
  return tokens;
}

/** SQLite's `sqlite3Fts5UnicodeIsdiacritic`. */
function isDiacritic(c: number): boolean {
  const mask0 = 0x08029fdf;
  const mask1 = 0x000361f8;
  if (c < 768 || c > 817) return false;
  return c < 768 + 32 ? (mask0 & (1 << (c - 768))) !== 0 : (mask1 & (1 << (c - 768 - 32))) !== 0;
}

// SQLite's `sqlite3Fts5UnicodeFold` tables, generated from CaseFolding.txt: [code, flags, range].
// prettier-ignore
const FOLD_ENTRIES = [
  65, 14, 26, 181, 64, 1, 192, 14, 23, 216, 14, 7, 256, 1, 48, 306, 1, 6, 313, 1, 16, 330, 1, 46, 376, 116, 1, 377, 1, 6,
  383, 104, 1, 385, 50, 1, 386, 1, 4, 390, 44, 1, 391, 0, 1, 393, 42, 2, 395, 0, 1, 398, 32, 1, 399, 38, 1, 400, 40, 1,
  401, 0, 1, 403, 42, 1, 404, 46, 1, 406, 52, 1, 407, 48, 1, 408, 0, 1, 412, 52, 1, 413, 54, 1, 415, 56, 1, 416, 1, 6,
  422, 60, 1, 423, 0, 1, 425, 60, 1, 428, 0, 1, 430, 60, 1, 431, 0, 1, 433, 58, 2, 435, 1, 4, 439, 62, 1, 440, 0, 1,
  444, 0, 1, 452, 2, 1, 453, 0, 1, 455, 2, 1, 456, 0, 1, 458, 2, 1, 459, 1, 18, 478, 1, 18, 497, 2, 1, 498, 1, 4,
  502, 122, 1, 503, 134, 1, 504, 1, 40, 544, 110, 1, 546, 1, 18, 570, 70, 1, 571, 0, 1, 573, 108, 1, 574, 68, 1, 577, 0, 1,
  579, 106, 1, 580, 28, 1, 581, 30, 1, 582, 1, 10, 837, 36, 1, 880, 1, 4, 886, 0, 1, 902, 18, 1, 904, 16, 3, 908, 26, 1,
  910, 24, 2, 913, 14, 17, 931, 14, 9, 962, 0, 1, 975, 4, 1, 976, 140, 1, 977, 142, 1, 981, 146, 1, 982, 144, 1, 984, 1, 24,
  1008, 136, 1, 1009, 138, 1, 1012, 130, 1, 1013, 128, 1, 1015, 0, 1, 1017, 152, 1, 1018, 0, 1, 1021, 110, 3, 1024, 34, 16, 1040, 14, 32,
  1120, 1, 34, 1162, 1, 54, 1216, 6, 1, 1217, 1, 14, 1232, 1, 88, 1329, 22, 38, 4256, 66, 38, 4295, 66, 1, 4301, 66, 1, 7680, 1, 150,
  7835, 132, 1, 7838, 96, 1, 7840, 1, 96, 7944, 150, 8, 7960, 150, 6, 7976, 150, 8, 7992, 150, 8, 8008, 150, 6, 8025, 151, 8, 8040, 150, 8,
  8072, 150, 8, 8088, 150, 8, 8104, 150, 8, 8120, 150, 2, 8122, 126, 2, 8124, 148, 1, 8126, 100, 1, 8136, 124, 4, 8140, 148, 1, 8152, 150, 2,
  8154, 120, 2, 8168, 150, 2, 8170, 118, 2, 8172, 152, 1, 8184, 112, 2, 8186, 114, 2, 8188, 148, 1, 8486, 98, 1, 8490, 92, 1, 8491, 94, 1,
  8498, 12, 1, 8544, 8, 16, 8579, 0, 1, 9398, 10, 26, 11264, 22, 47, 11360, 0, 1, 11362, 88, 1, 11363, 102, 1, 11364, 90, 1, 11367, 1, 6,
  11373, 84, 1, 11374, 86, 1, 11375, 80, 1, 11376, 82, 1, 11378, 0, 1, 11381, 0, 1, 11390, 78, 2, 11392, 1, 100, 11499, 1, 4, 11506, 0, 1,
  42560, 1, 46, 42624, 1, 24, 42786, 1, 14, 42802, 1, 62, 42873, 1, 4, 42877, 76, 1, 42878, 1, 10, 42891, 0, 1, 42893, 74, 1, 42896, 1, 4,
  42912, 1, 10, 42922, 72, 1, 65313, 14, 26,
];
// prettier-ignore
const FOLD_OFFSETS = [
  1, 2, 8, 15, 16, 26, 28, 32, 37, 38, 40, 48, 63, 64, 69, 71, 79, 80, 116, 202, 203, 205, 206, 207, 209, 210, 211, 213, 214,
  217, 218, 219, 775, 7264, 10792, 10795, 23228, 23256, 30204, 54721, 54753, 54754, 54756, 54787, 54793, 54809, 57153, 57274,
  57921, 58019, 58363, 61722, 65268, 65341, 65373, 65406, 65408, 65410, 65415, 65424, 65436, 65439, 65450, 65462, 65472, 65476,
  65478, 65480, 65482, 65488, 65506, 65511, 65514, 65521, 65527, 65528, 65529,
];

/** SQLite's `sqlite3Fts5UnicodeFold(c, 2)` for a non-ASCII code point; 0 drops it. */
function fold(c: number): number {
  if (c >= 65536) return c >= 66560 && c < 66600 ? c + 40 : c;
  let lo = 0;
  let hi = FOLD_ENTRIES.length / 3 - 1;
  let found = -1;
  while (hi >= lo) {
    const mid = (lo + hi) >> 1;
    if (c - FOLD_ENTRIES[mid * 3] >= 0) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  let ret = c;
  const code = FOLD_ENTRIES[found * 3], flags = FOLD_ENTRIES[found * 3 + 1], range = FOLD_ENTRIES[found * 3 + 2];
  if (c < code + range && (0x01 & flags & (code ^ c)) === 0) ret = (c + FOLD_OFFSETS[flags >> 1]) & 0xffff;
  return removeDiacritic(ret);
}

// SQLite's `fts5_remove_diacritic` tables.
// prettier-ignore
const DIA = [
  0, 1797, 1848, 1859, 1891, 1928, 1940, 1995, 2024, 2040, 2060, 2110, 2168, 2206, 2264, 2286, 2344, 2383, 2472, 2488, 2516,
  2596, 2668, 2732, 2782, 2842, 2894, 2954, 2984, 3000, 3028, 3336, 3456, 3696, 3712, 3728, 3744, 3766, 3832, 3896, 3912, 3928,
  3944, 3968, 4008, 4040, 4056, 4106, 4138, 4170, 4202, 4234, 4266, 4296, 4312, 4344, 4408, 4424, 4442, 4472, 4488, 4504, 6148,
  6198, 6264, 6280, 6360, 6429, 6505, 6529, 61448, 61468, 61512, 61534, 61592, 61610, 61642, 61672, 61688, 61704, 61726, 61784,
  61800, 61816, 61836, 61880, 61896, 61914, 61948, 61998, 62062, 62122, 62154, 62184, 62200, 62218, 62252, 62302, 62364, 62410,
  62442, 62478, 62536, 62554, 62584, 62604, 62640, 62648, 62656, 62664, 62730, 62766, 62830, 62890, 62924, 62974, 63032, 63050,
  63082, 63118, 63182, 63242, 63274, 63310, 63368, 63390,
];
/** The base letter for each `DIA` entry, '\0' for none. */
const DIA_CHARS =
  '\0aceinouyyacdeeghijklnorstuuwyzouaiouuagkoojgnaaeiorusthaeoooy\0\0\0\0\0\0\0\0abcddeeefghhiiklllmnoprrrsstuuvwwxyzhtwyaaaaeeeioooouuuy';

function removeDiacritic(c: number): number {
  const key = ((c << 3) | 7) >>> 0;
  let lo = 0;
  let hi = DIA.length - 1;
  let res = 0;
  while (hi >= lo) {
    const mid = (lo + hi) >> 1;
    if (key >= DIA[mid]) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (c > (DIA[res] >> 3) + (DIA[res] & 0x07)) return c;
  // SQLite marks some entries "complex" (several diacritics); remove_diacritics 2 takes them too.
  return DIA_CHARS.charCodeAt(res);
}

// ── The table ─────────────────────────────────────────────────────────────────

/** One phrase of a query: consecutive terms, the last a prefix when `prefix`. */
export interface Phrase {
  terms: string[];
  prefix: boolean;
  /** Only this column, as `col : "phrase"`; any when null. */
  column: number | null;
}

/** A query: every `all` phrase must match, no `none` phrase may (`a AND b NOT c`). */
export interface Query {
  all: Phrase[];
  none: Phrase[];
}

/** A phrase of `text` as the tokenizer splits it. */
export function phrase(text: string, prefix = false, column: number | null = null): Phrase {
  return { terms: tokenize(text).map((t) => t.text), prefix, column };
}

/** An instance of phrase `phrase` at token `offset` of `column`. */
interface Inst {
  phrase: number;
  column: number;
  offset: number;
}

interface Row {
  texts: string[];
  /** Folded tokens per column. */
  columns: string[][];
  /** Where each token is, per column. */
  positions: Map<string, number[]>[];
  size: number;
}

export interface Match {
  rowid: number;
  rank: number;
  insts: Inst[];
  /** Each phrase's length in tokens. */
  sizes: number[];
}

/**
 * An FTS5 table in memory, with fixed columns and `bm25` column weights.
 */
export class FullTextTable {
  private rows = new Map<number, Row>();
  private postings = new Map<string, Set<number>>();
  private totalTokens = 0;

  constructor(private readonly weights: number[]) {}

  set(rowid: number, texts: string[]): void {
    this.delete(rowid);
    const columns = texts.map((t) => tokenize(t).map((token) => token.text));
    const positions = columns.map((tokens) => {
      const map = new Map<string, number[]>();
      tokens.forEach((token, i) => {
        const list = map.get(token);
        if (list) list.push(i);
        else map.set(token, [i]);
      });
      return map;
    });
    const row: Row = { texts, columns, positions, size: columns.reduce((n, c) => n + c.length, 0) };
    this.rows.set(rowid, row);
    this.totalTokens += row.size;
    for (const column of columns) {
      for (const token of column) {
        let set = this.postings.get(token);
        if (!set) this.postings.set(token, (set = new Set()));
        set.add(rowid);
      }
    }
  }

  delete(rowid: number): void {
    const row = this.rows.get(rowid);
    if (!row) return;
    this.rows.delete(rowid);
    this.totalTokens -= row.size;
    for (const column of row.columns) {
      for (const token of column) {
        const set = this.postings.get(token);
        if (set && set.delete(rowid) && set.size === 0) this.postings.delete(token);
      }
    }
  }

  /** The text of one column of a row. */
  text(rowid: number, column: number): string {
    return this.rows.get(rowid)?.texts[column] ?? '';
  }

  /**
   * The rows matching `query`, best first (`ORDER BY rank`): bm25 with this table's weights,
   * ties by rowid.
   */
  match(query: Query): Match[] {
    const phrases = [...query.all, ...query.none];
    // An empty phrase matches nothing: so does an AND with one. A NOT with one excludes nothing.
    if (query.all.length === 0 || query.all.some((p) => p.terms.length === 0)) return [];

    // Candidates: the rows holding every term of every required phrase.
    const sets = query.all
      .flatMap((p) => p.terms.map((term, i) => this.rowsWithTerm(term, p.prefix && i === p.terms.length - 1)))
      .sort((x, y) => x.size - y.size);
    const candidates = [...sets[0]].filter((r) => sets.every((s) => s.has(r)));

    const sizes = phrases.map((p) => p.terms.length);
    const matches: Match[] = [];
    for (const rowid of candidates) {
      const insts = this.instances(this.rows.get(rowid)!, phrases);
      const has = (i: number) => insts.some((inst) => inst.phrase === i);
      if (query.all.every((_, i) => has(i)) && !query.none.some((_, i) => has(query.all.length + i))) {
        matches.push({ rowid, rank: 0, insts, sizes });
      }
    }
    if (matches.length === 0) return matches;

    // bm25, as fts5Bm25Function.
    const k1 = 1.2, b = 0.75;
    const nRow = this.rows.size;
    const avgdl = this.totalTokens / nRow;
    const idf = phrases.map((p) => {
      const nHit = this.rowsMatching(p);
      const v = Math.log((nRow - nHit + 0.5) / (nHit + 0.5));
      return v <= 0 ? 1e-6 : v;
    });
    for (const m of matches) {
      const freq = phrases.map(() => 0);
      for (const inst of m.insts) freq[inst.phrase] += this.weights[inst.column] ?? 1;
      const D = this.rows.get(m.rowid)!.size;
      let score = 0;
      for (let i = 0; i < phrases.length; i++) {
        score += idf[i] * ((freq[i] * (k1 + 1)) / (freq[i] + k1 * (1 - b + (b * D) / avgdl)));
      }
      m.rank = -score;
    }
    return matches.sort((x, y) => x.rank - y.rank || x.rowid - y.rowid);
  }

  /** `snippet(table, column, open, close, ellipsis, nToken)` for a match. */
  snippet(match: Match, column: number, open: string, close: string, ellipsis: string, nToken: number): string {
    const text = this.text(match.rowid, column);
    const tokens = tokenize(text);
    const nDocsize = tokens.length;
    const insts = match.insts;
    const phraseSize = (i: number) => match.sizes[i];
    let bestScore = 0;
    let bestStart = 0;

    // Sentence starts: the first token, and any after `.` or `:` and whitespace.
    const firsts: number[] = [];
    tokens.forEach((t, pos) => {
      if (pos === 0) return firsts.push(0);
      let i = t.start - 1;
      let c = '';
      for (; i >= 0; i--) {
        c = text[i];
        if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') break;
      }
      if (i !== t.start - 1 && (c === '.' || c === ':')) firsts.push(pos);
    });

    const score = (iPos: number): { score: number; adjusted: number } => {
      const seen = new Set<number>();
      let s = 0, first = -1, last = 0;
      const end = iPos + nToken;
      for (const inst of insts) {
        if (inst.column === column && inst.offset >= iPos && inst.offset < end) {
          s += seen.has(inst.phrase) ? 1 : 1000;
          seen.add(inst.phrase);
          if (first < 0) first = inst.offset;
          last = inst.offset + phraseSize(inst.phrase);
        }
      }
      let adjusted = first - Math.trunc((nToken - (last - first)) / 2);
      if (adjusted + nToken > nDocsize) adjusted = nDocsize - nToken;
      if (adjusted < 0) adjusted = 0;
      return { score: s, adjusted };
    };

    for (const inst of insts) {
      if (inst.column !== column) continue;
      const here = score(inst.offset);
      if (here.score > bestScore) { bestScore = here.score; bestStart = here.adjusted; }
      if (firsts.length && nDocsize > nToken) {
        let jj = 0;
        for (; jj < firsts.length - 1; jj++) if (firsts[jj + 1] > inst.offset) break;
        if (firsts[jj] < inst.offset) {
          const s = score(firsts[jj]).score + (firsts[jj] === 0 ? 120 : 100);
          if (s > bestScore) { bestScore = s; bestStart = firsts[jj]; }
        }
      }
    }

    // fts5HighlightCb over the chosen range, with coalesced instances.
    const coalesced: { start: number; end: number }[] = [];
    for (const inst of insts) {
      if (inst.column !== column) continue;
      const end = inst.offset - 1 + phraseSize(inst.phrase);
      const lastRange = coalesced[coalesced.length - 1];
      if (lastRange && inst.offset <= lastRange.end) lastRange.end = Math.max(lastRange.end, end);
      else coalesced.push({ start: inst.offset, end });
    }
    let it = 0;
    while (it < coalesced.length && coalesced[it].start < bestStart) it++;
    const iter = () => coalesced[it] ?? { start: -1, end: -1 };

    const rangeStart = bestStart, rangeEnd = bestStart + nToken - 1;
    let out = bestStart > 0 ? ellipsis : '';
    let off = 0;
    let isOpen = false;
    tokens.forEach((t, pos) => {
      if (pos < rangeStart || pos > rangeEnd) return;
      if (rangeStart && pos === rangeStart) off = t.start;
      if (isOpen && (pos <= iter().start || iter().start < 0) && t.start > off) {
        out += close;
        isOpen = false;
      }
      if (pos === iter().start && !isOpen) {
        out += text.slice(off, t.start) + open;
        off = t.start;
        isOpen = true;
      }
      if (pos === iter().end) {
        if (!isOpen) { out += open; isOpen = true; }
        out += text.slice(off, t.end);
        off = t.end;
        it++;
      }
      if (pos === rangeEnd) {
        if (isOpen) {
          if (iter().start >= 0 && pos >= iter().start) {
            out += text.slice(off, t.end);
            off = t.end;
          }
          out += close;
          isOpen = false;
        }
        out += text.slice(off, t.end);
        off = t.end;
      }
    });
    if (isOpen) out += close;
    out += rangeEnd >= nDocsize - 1 ? text.slice(off) : ellipsis;
    return out;
  }

  private rowsWithTerm(term: string, prefix: boolean): Set<number> {
    if (!prefix) return this.postings.get(term) ?? new Set();
    const out = new Set<number>();
    for (const [token, rows] of this.postings) if (token.startsWith(term)) for (const r of rows) out.add(r);
    return out;
  }

  /** How many rows hold `p` (in its column, if it has one). */
  private rowsMatching(p: Phrase): number {
    if (p.terms.length === 0) return 0;
    const rows = this.rowsWithTerm(p.terms[0], p.prefix && p.terms.length === 1);
    if (p.terms.length === 1 && p.column === null) return rows.size;
    let n = 0;
    for (const rowid of rows) if (this.instances(this.rows.get(rowid)!, [p]).length) n++;
    return n;
  }

  /** Every instance of `phrases` in `row`, ordered by column, offset, then phrase (xInst order). */
  private instances(row: Row, phrases: Phrase[]): Inst[] {
    const out: Inst[] = [];
    phrases.forEach((p, i) => {
      const n = p.terms.length;
      if (n === 0) return;
      const matches = (token: string, t: number) => (p.prefix && t === n - 1 ? token.startsWith(p.terms[t]) : token === p.terms[t]);
      row.columns.forEach((tokens, column) => {
        if (p.column !== null && p.column !== column) return;
        // Where the first term is, then the rest checked in place.
        let starts: number[];
        if (p.prefix && n === 1) {
          starts = [];
          for (const [token, at] of row.positions[column]) if (token.startsWith(p.terms[0])) starts.push(...at);
        } else {
          starts = row.positions[column].get(p.terms[0]) ?? [];
        }
        for (const offset of starts) {
          if (offset + n > tokens.length) continue;
          let ok = true;
          for (let t = 1; t < n && ok; t++) ok = matches(tokens[offset + t], t);
          if (ok) out.push({ phrase: i, column, offset });
        }
      });
    });
    // xInst order: by column, then offset, then phrase.
    return out.sort((a, b) => a.column - b.column || a.offset - b.offset || a.phrase - b.phrase);
  }
}
