/**
 * Headers and footers for the docs editor.
 *
 * A document does not hold one header and one footer. It holds up to three of
 * each — the word-processor convention, which this follows:
 *
 *   `default`  every page, or the odd pages once even/odd is split
 *   `first`    page 1, when `differentFirstPage` is on (title pages)
 *   `even`     the even pages, when `differentEvenOdd` is on (facing pages,
 *              where the page number sits on the outer edge and so swaps sides)
 *
 * The switches are stored separately from the content, so turning
 * `differentFirstPage` off hides the first-page header without discarding what
 * was typed into it — turning it back on brings the text back, which is what
 * makes the checkbox safe to toggle while looking at the page.
 *
 * Each band is three slots (left / center / right) rather than one string. That
 * is what lets "Draft" sit on the left of the same line as a page number on the
 * right, and it is what an even-page variant needs in order to mirror an odd
 * one. Slots hold plain text with the document's own `{{field}}` tokens
 * (`docFields` owns the codes), resolved at
 * render time, never at edit time: a stored page number would be wrong on every
 * page but the one it was typed on, and a stored date would freeze the day the
 * document was written.
 *
 * Geometry lives here too (`headerMargin` / `footerMargin`) because the bands
 * are positioned inside the page's top and bottom margins, above and below the
 * text column — not in the flow. They are carried in the same unit as
 * `PageSetup`'s margins — points — and, like those, rendered on screen as CSS
 * px. That keeps a header at half the top margin's value sitting halfway up the
 * top margin in every medium, which is the property that matters; the editor's
 * px-for-pt screen scale is a separate, older question.
 */

import {
  FIELD_TOKEN_SOURCE,
  docFieldText,
  emptyDocProperties,
  parseFieldToken,
  type DocFieldContext,
  type DocProperties,
} from '@/lib/docFields';

export type HeaderFooterBand = 'header' | 'footer';
export type HeaderFooterSlot = 'left' | 'center' | 'right';
export type HeaderFooterVariant = 'default' | 'first' | 'even';

/** One band: three independently aligned slots on a single line. */
export interface HeaderFooterSlots {
  left: string;
  center: string;
  right: string;
}

/** The header and footer of one variant. */
export interface HeaderFooterPair {
  header: HeaderFooterSlots;
  footer: HeaderFooterSlots;
}

export interface HeaderFooterConfig {
  /** Give page 1 its own header and footer. */
  differentFirstPage: boolean;
  /** Split the remaining pages into odd (`default`) and `even`. */
  differentEvenOdd: boolean;
  /** Top of the sheet to the top of the header band, in points. */
  headerMargin: number;
  /** Bottom of the sheet to the bottom of the footer band, in points. */
  footerMargin: number;
  variants: Record<HeaderFooterVariant, HeaderFooterPair>;
}

/** The tokens the band toolbar has a button for. */
export const FIELDS = {
  page: '{{page}}',
  pages: '{{pages}}',
  title: '{{title}}',
  date: '{{date}}',
} as const;

export type FieldName = keyof typeof FIELDS;

/**
 * What a page needs to know to resolve the tokens in its bands.
 *
 * This is `DocFieldContext` with the properties optional, because a band
 * resolved by a caller that has none — the PDF export, say — must still resolve
 * `{{page}}` and `{{title}}`.
 */
export type FieldContext = Omit<DocFieldContext, 'properties'> & {
  properties?: DocProperties;
};

/** 0.5in, the word-processor default, in points. */
export const HEADER_FOOTER_MARGIN_DEFAULT = 36;

function emptySlots(): HeaderFooterSlots {
  return { left: '', center: '', right: '' };
}

function emptyPair(): HeaderFooterPair {
  return { header: emptySlots(), footer: emptySlots() };
}

export function defaultHeaderFooterConfig(): HeaderFooterConfig {
  return {
    differentFirstPage: false,
    differentEvenOdd: false,
    headerMargin: HEADER_FOOTER_MARGIN_DEFAULT,
    footerMargin: HEADER_FOOTER_MARGIN_DEFAULT,
    variants: { default: emptyPair(), first: emptyPair(), even: emptyPair() },
  };
}

/**
 * Which variant page `page` (1-based) renders.
 *
 * First page wins over even/odd: page 2 of a document with both switches on is
 * the even variant, but page 1 is the first-page variant rather than the odd
 * one it would otherwise be.
 */
export function variantForPage(page: number, config: HeaderFooterConfig): HeaderFooterVariant {
  if (config.differentFirstPage && page === 1) return 'first';
  if (config.differentEvenOdd && page % 2 === 0) return 'even';
  return 'default';
}

/**
 * The label for a variant as the toolbar names it. `default` is "Odd page"
 * only when there is an even variant to contrast it with — otherwise it is
 * every page, and calling it odd would be a lie.
 */
export function variantLabel(
  variant: HeaderFooterVariant,
  band: HeaderFooterBand,
  config: HeaderFooterConfig,
): string {
  const noun = band === 'header' ? 'header' : 'footer';
  if (variant === 'first') return `First page ${noun}`;
  if (variant === 'even') return `Even page ${noun}`;
  if (config.differentEvenOdd) return `Odd page ${noun}`;
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * Replace every `{{field}}` token in `text` with its value for this page.
 *
 * The codes are the document's codes — `docFields` owns them — so a band reads
 * `{{author:My Self}}` and a custom property exactly as the body does, and one
 * autocomplete can serve both. A token whose code resolves to nothing and has
 * no fallback is removed rather than left as itself: in the body an unresolved
 * field is a chip you can see and click, but a band is plain text, and literal
 * braces printed across the top of every page are never what was meant.
 */
export function resolveFields(text: string, ctx: FieldContext): string {
  if (!text) return '';
  const full: DocFieldContext = { ...ctx, properties: ctx.properties ?? emptyDocProperties() };
  return text.replace(new RegExp(FIELD_TOKEN_SOURCE, 'g'), token => {
    const spec = parseFieldToken(token);
    // The parser and the pattern agree, so this cannot normally miss; a token
    // it does reject is left as typed rather than silently deleted.
    return spec ? docFieldText(spec, full, false) : token;
  });
}

/** Whether a band has anything to draw. */
export function hasBandContent(slots: HeaderFooterSlots): boolean {
  return Boolean(slots.left || slots.center || slots.right);
}

/** Whether any variant in use has anything to draw. */
export function hasAnyContent(config: HeaderFooterConfig): boolean {
  const variants: HeaderFooterVariant[] = ['default'];
  if (config.differentFirstPage) variants.push('first');
  if (config.differentEvenOdd) variants.push('even');
  return variants.some(
    v => hasBandContent(config.variants[v].header) || hasBandContent(config.variants[v].footer),
  );
}

/** A copy of `config` with one slot replaced. */
export function setSlot(
  config: HeaderFooterConfig,
  variant: HeaderFooterVariant,
  band: HeaderFooterBand,
  slot: HeaderFooterSlot,
  value: string,
): HeaderFooterConfig {
  return {
    ...config,
    variants: {
      ...config.variants,
      [variant]: {
        ...config.variants[variant],
        [band]: { ...config.variants[variant][band], [slot]: value },
      },
    },
  };
}

/** A copy of `config` with every slot of one band emptied. */
export function clearBand(
  config: HeaderFooterConfig,
  variant: HeaderFooterVariant,
  band: HeaderFooterBand,
): HeaderFooterConfig {
  return {
    ...config,
    variants: {
      ...config.variants,
      [variant]: { ...config.variants[variant], [band]: emptySlots() },
    },
  };
}

/**
 * Documents written before this feature stored one header string, one footer
 * string, and a `showPageNumbers` flag whose only effect was whether `{{page}}`
 * was substituted. Both strings rendered left-aligned, so they migrate into the
 * left slot of the default variant.
 *
 * `showPageNumbers` has no successor: a token now always resolves, because a
 * literal `{{page}}` sitting in a printed footer is never what was meant. When
 * it was off, the token is stripped rather than left to appear as itself.
 */
export function migrateLegacyHeaderFooter(
  headerText: string,
  footerText: string,
  showPageNumbers: boolean,
): HeaderFooterConfig {
  const config = defaultHeaderFooterConfig();
  const carry = (text: string) =>
    showPageNumbers ? text : text.replace(/\{\{\s*page\s*\}\}/g, '').trim();
  config.variants.default.header.left = carry(headerText ?? '');
  config.variants.default.footer.left = carry(footerText ?? '');
  return config;
}

function readSlots(raw: unknown): HeaderFooterSlots {
  const r = (raw ?? {}) as Partial<HeaderFooterSlots>;
  return {
    left: typeof r.left === 'string' ? r.left : '',
    center: typeof r.center === 'string' ? r.center : '',
    right: typeof r.right === 'string' ? r.right : '',
  };
}

function readPair(raw: unknown): HeaderFooterPair {
  const r = (raw ?? {}) as Partial<HeaderFooterPair>;
  return { header: readSlots(r.header), footer: readSlots(r.footer) };
}

function readMargin(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
    ? raw
    : HEADER_FOOTER_MARGIN_DEFAULT;
}

/**
 * Read a config out of a stored `_meta` blob. Every field is optional and
 * defaulted: a document saved by an older build, by a build mid-migration, or
 * with a hand-edited file still has to open.
 */
export function normalizeHeaderFooterConfig(raw: unknown): HeaderFooterConfig {
  const r = (raw ?? {}) as Partial<HeaderFooterConfig>;
  const variants = (r.variants ?? {}) as Partial<Record<HeaderFooterVariant, unknown>>;
  return {
    differentFirstPage: r.differentFirstPage === true,
    differentEvenOdd: r.differentEvenOdd === true,
    headerMargin: readMargin(r.headerMargin),
    footerMargin: readMargin(r.footerMargin),
    variants: {
      default: readPair(variants.default),
      first: readPair(variants.first),
      even: readPair(variants.even),
    },
  };
}

/**
 * Flatten a config back into the legacy `headerText` / `footerText` fields kept
 * alongside it in `_meta`. They are what a build without this feature reads, so
 * a document round-tripped through an older client still shows its default
 * header rather than nothing at all.
 */
export function legacyFieldsFor(config: HeaderFooterConfig): {
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
} {
  const join = (slots: HeaderFooterSlots) =>
    [slots.left, slots.center, slots.right].filter(Boolean).join('  ');
  const headerText = join(config.variants.default.header);
  const footerText = join(config.variants.default.footer);
  return {
    headerText,
    footerText,
    showPageNumbers: /\{\{\s*page\s*\}\}/.test(headerText + footerText),
  };
}
