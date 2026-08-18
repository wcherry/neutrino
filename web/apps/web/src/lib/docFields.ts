/**
 * Field codes for the docs editor — the word-processor feature where a token
 * typed into the text stands for a value the document does not itself hold.
 *
 * Typing `{{title}}` puts the document's title into the paragraph; `{{page}}`
 * puts the number of the page the token happens to land on; `{{author:My Self}}`
 * puts the author out of the document's properties, or `My Self` when that
 * property has never been filled in. The part after the colon is always the
 * fallback, for every code — a field whose source is empty renders the fallback
 * instead of a gap, which is what makes a code worth typing into a template that
 * will be filled in later.
 *
 * **Nothing here is ever stored resolved.** A field in the document is the code
 * and its fallback; the value is produced when the field is drawn, from a
 * context the editor supplies. This is the same rule headers and footers follow
 * (see `docHeaderFooter`) and for the same reason: a stored page number is wrong
 * on every page but the one it was typed on, a stored title survives a rename,
 * and a stored date freezes the day the document was written. It is also what
 * makes "refresh" cheap — there is no cache to invalidate, only a repaint.
 *
 * This module is the pure half: parsing a token, naming the codes, and turning a
 * code plus a context into a string. The Tiptap node that puts one in a document
 * is `DocFieldExtension`, which is the only thing that knows about positions,
 * measurement and repainting.
 */

/** A field as it appears in the document: a code, and a fallback for it. */
export interface DocFieldSpec {
  /** Canonical code — `page`, not the `page-number` someone may have typed. */
  code: string;
  /** Text to show when the code resolves to nothing. `null` when none was given. */
  arg: string | null;
}

/** The document properties a field can read. */
export interface DocProperties {
  author: string;
  subject: string;
  company: string;
  category: string;
  keywords: string;
  manager: string;
  /** Anything else the user has named, reachable as `{{whatever}}`. */
  custom: Record<string, string>;
}

/** What a field needs in order to resolve. */
export interface DocFieldContext {
  title: string;
  /** The page the field sits on, 1-based. */
  page: number;
  /** Pages in the document. */
  pages: number;
  properties: DocProperties;
  /** Injected so a render is deterministic; defaults to now. */
  date?: Date;
}

export interface DocFieldDef {
  code: string;
  /** How the insert menu names it. */
  label: string;
  /** One line for a tooltip. */
  hint: string;
  /** Other spellings that resolve to `code`. */
  aliases?: string[];
}

/**
 * The codes with a meaning of their own. Anything not listed here is looked up
 * in `properties.custom`, so `{{project:Untitled}}` works without this file
 * knowing what a project is.
 */
export const FIELD_DEFS: DocFieldDef[] = [
  { code: 'title', label: 'Title', hint: "The document's title" },
  {
    code: 'page',
    label: 'Page number',
    hint: 'The number of the page this field is on',
    aliases: ['page-number', 'pagenumber', 'page_number'],
  },
  {
    code: 'pages',
    label: 'Page count',
    hint: 'The number of pages in the document',
    aliases: ['page-count', 'pagecount', 'total-pages', 'num-pages'],
  },
  { code: 'date', label: 'Date', hint: "Today's date" },
  { code: 'time', label: 'Time', hint: 'The time of day' },
  { code: 'author', label: 'Author', hint: 'The author property', aliases: ['creator'] },
  { code: 'subject', label: 'Subject', hint: 'The subject property' },
  { code: 'company', label: 'Company', hint: 'The company property' },
  { code: 'category', label: 'Category', hint: 'The category property' },
  { code: 'keywords', label: 'Keywords', hint: 'The keywords property' },
  { code: 'manager', label: 'Manager', hint: 'The manager property' },
];

/** The property codes, in the order the properties dialog lists them. */
export const PROPERTY_CODES = [
  'author',
  'subject',
  'company',
  'category',
  'keywords',
  'manager',
] as const;

export type PropertyCode = (typeof PROPERTY_CODES)[number];

const ALIAS_TO_CODE = new Map<string, string>(
  FIELD_DEFS.flatMap(def => [
    [def.code, def.code] as [string, string],
    ...(def.aliases ?? []).map(a => [a, def.code] as [string, string]),
  ]),
);

/**
 * One field token. Deliberately not anchored and not global: callers that need
 * either build their own from `FIELD_TOKEN_SOURCE`, and a shared global regex
 * would carry `lastIndex` between them.
 */
export const FIELD_TOKEN_SOURCE = String.raw`\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?::([^{}]*))?\}\}`;

/** The canonical code for whatever spelling was typed; lower-cased. */
export function canonicalFieldCode(code: string): string {
  const key = code.trim().toLowerCase();
  return ALIAS_TO_CODE.get(key) ?? key;
}

/** The definition for a code, or `undefined` for a custom property. */
export function fieldDef(code: string): DocFieldDef | undefined {
  return FIELD_DEFS.find(d => d.code === canonicalFieldCode(code));
}

/**
 * Read a `{{code}}` / `{{code:fallback}}` token. Returns `null` for anything
 * that is not exactly one whole token, so a paragraph containing a token is not
 * mistaken for one.
 */
export function parseFieldToken(text: string): DocFieldSpec | null {
  const match = new RegExp(`^${FIELD_TOKEN_SOURCE}$`).exec(text.trim());
  if (!match) return null;
  return fieldSpecFromMatch(match);
}

/** Build a spec from a match of `FIELD_TOKEN_SOURCE` — group 1 code, group 2 arg. */
export function fieldSpecFromMatch(match: RegExpMatchArray): DocFieldSpec {
  const arg = match[2] === undefined ? null : match[2].trim();
  return {
    code: canonicalFieldCode(match[1]),
    // An empty fallback (`{{author:}}`) is the same as none: there is nothing to
    // fall back to, and keeping the distinction would only show up as a
    // stray colon when the code is displayed.
    arg: arg ? arg : null,
  };
}

/** The token text for a spec — what the field shows when it is showing its code. */
export function formatFieldToken(spec: DocFieldSpec): string {
  return spec.arg ? `{{${spec.code}:${spec.arg}}}` : `{{${spec.code}}}`;
}

// ── Autocomplete ────────────────────────────────────────────────────────────

/** One row of the menu that opens while a `{{` token is being typed. */
export interface FieldSuggestion {
  code: string;
  label: string;
  hint: string;
  /** A property this document names, rather than a code built in here. */
  custom: boolean;
}

/**
 * How well a candidate matches. Lower is better, `Infinity` is no match.
 *
 * A term the query *starts* is always better than one it merely appears
 * inside, and among the latter an earlier appearance is better — so typing `p`
 * offers Page number and Page count before Company, which contains a p only in
 * the middle. Aliases are searched too, so someone typing the `page-number`
 * they know from another word processor still finds the field.
 */
function suggestionScore(terms: string[], query: string): number {
  let best = Infinity;
  for (const term of terms) {
    const at = term.indexOf(query);
    if (at === 0) return 0;
    if (at > 0) best = Math.min(best, 1 + at);
  }
  return best;
}

/**
 * The codes to offer for a partly-typed token, best first. An empty query
 * offers everything, which is what makes typing `{{` a way to find out what
 * there is.
 */
export function fieldSuggestions(
  query: string,
  customCodes: readonly string[] = [],
): FieldSuggestion[] {
  const seen = new Set(FIELD_DEFS.map(d => d.code));
  const candidates: { item: FieldSuggestion; terms: string[] }[] = [
    ...FIELD_DEFS.map(def => ({
      item: { code: def.code, label: def.label, hint: def.hint, custom: false },
      terms: [def.code, def.label.toLowerCase(), ...(def.aliases ?? [])],
    })),
  ];

  // Listed after the built-ins, and never twice: a custom property named for a
  // built-in code is unreachable anyway (see `normalizeDocProperties`).
  for (const raw of customCodes) {
    const code = canonicalFieldCode(raw);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    candidates.push({
      item: { code, label: code, hint: 'A property of this document', custom: true },
      terms: [code],
    });
  }

  const q = query.trim().toLowerCase();
  if (!q) return candidates.map(c => c.item);

  return candidates
    .map((c, order) => ({ item: c.item, order, score: suggestionScore(c.terms, q) }))
    .filter(c => c.score !== Infinity)
    // Declaration order breaks ties, so equally-good matches keep the order the
    // menu shows with nothing typed rather than jumping around per keystroke.
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(c => c.item);
}

export function emptyDocProperties(): DocProperties {
  return { author: '', subject: '', company: '', category: '', keywords: '', manager: '', custom: {} };
}

/**
 * Read properties out of a stored `_meta` blob. Every field is optional: a
 * document saved before properties existed, or with a hand-edited file, still
 * has to open.
 */
export function normalizeDocProperties(raw: unknown): DocProperties {
  const r = (raw ?? {}) as Partial<Record<string, unknown>>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const custom: Record<string, string> = {};
  const rawCustom = (r.custom ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rawCustom)) {
    const code = canonicalFieldCode(key);
    // A custom property that collides with a built-in code would be shadowed by
    // it and never readable, so it is dropped rather than kept as dead weight.
    if (typeof value === 'string' && code && !fieldDef(code)) custom[code] = value;
  }
  return {
    author: str(r.author),
    subject: str(r.subject),
    company: str(r.company),
    category: str(r.category),
    keywords: str(r.keywords),
    manager: str(r.manager),
    custom,
  };
}

/** Whether any property has been filled in — whether the blob is worth storing. */
export function hasDocProperties(props: DocProperties): boolean {
  return (
    PROPERTY_CODES.some(code => Boolean(props[code])) ||
    Object.values(props.custom).some(Boolean)
  );
}

/**
 * The value behind a code, before any fallback. Empty string means "no value" —
 * which is what hands the field over to its fallback.
 */
function fieldValue(code: string, ctx: DocFieldContext): string {
  switch (code) {
    case 'title':
      return ctx.title.trim();
    case 'page':
      return String(Math.max(1, Math.round(ctx.page)));
    case 'pages':
      return String(Math.max(1, Math.round(ctx.pages)));
    case 'date':
      return (ctx.date ?? new Date()).toLocaleDateString();
    case 'time':
      return (ctx.date ?? new Date()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    default:
      break;
  }
  if ((PROPERTY_CODES as readonly string[]).includes(code)) {
    return ctx.properties[code as PropertyCode].trim();
  }
  return (ctx.properties.custom[code] ?? '').trim();
}

/** What a field shows, and whether it is showing a real value or a stand-in. */
export interface ResolvedField {
  text: string;
  /**
   * `value` — the code resolved. `fallback` — it did not, and the text after the
   * colon is standing in. `unresolved` — it did not and there was nothing to
   * stand in with, so the code itself is shown; a field pointing at a property
   * nobody has filled in should be visible, not invisible.
   */
  state: 'value' | 'fallback' | 'unresolved';
}

export function resolveDocField(spec: DocFieldSpec, ctx: DocFieldContext): ResolvedField {
  const value = fieldValue(spec.code, ctx);
  if (value) return { text: value, state: 'value' };
  if (spec.arg) return { text: spec.arg, state: 'fallback' };
  return { text: formatFieldToken(spec), state: 'unresolved' };
}

/** The text a field contributes to a plain-text render of the document. */
export function docFieldText(
  spec: DocFieldSpec,
  ctx: DocFieldContext,
  showCode: boolean,
): string {
  if (showCode) return formatFieldToken(spec);
  const { text, state } = resolveDocField(spec, ctx);
  // An unresolved field's "text" is its own code, which is right on screen —
  // it is the thing you click to fix — but wrong in an export, where it would
  // read as literal braces someone forgot to remove.
  return state === 'unresolved' ? '' : text;
}
