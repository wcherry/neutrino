/**
 * Tests for the header/footer model — which of the three variants a page
 * renders, how field tokens resolve, and how documents written before variants
 * existed are migrated.
 *
 * The variant rule is the part worth pinning: it is the whole feature, it is
 * invisible until a document is long enough to have an even page, and getting
 * the precedence backwards (even/odd beating first page) silently puts the
 * wrong header on page 1 of every document with both switches on.
 */

import { describe, it, expect } from 'vitest';
import {
  clearBand,
  defaultHeaderFooterConfig,
  hasAnyContent,
  legacyFieldsFor,
  migrateLegacyHeaderFooter,
  normalizeHeaderFooterConfig,
  resolveFields,
  setSlot,
  variantForPage,
  variantLabel,
  type HeaderFooterConfig,
} from '@/lib/docHeaderFooter';
import { emptyDocProperties } from '@/lib/docFields';

function configWith(over: Partial<HeaderFooterConfig>): HeaderFooterConfig {
  return { ...defaultHeaderFooterConfig(), ...over };
}

describe('variantForPage', () => {
  it('uses the default variant everywhere when both switches are off', () => {
    const config = defaultHeaderFooterConfig();
    for (const page of [1, 2, 3, 8]) {
      expect(variantForPage(page, config)).toBe('default');
    }
  });

  it('gives page 1 its own variant when different-first-page is on', () => {
    const config = configWith({ differentFirstPage: true });
    expect(variantForPage(1, config)).toBe('first');
    expect(variantForPage(2, config)).toBe('default');
    expect(variantForPage(3, config)).toBe('default');
  });

  it('splits even from odd, leaving odd on the default variant', () => {
    const config = configWith({ differentEvenOdd: true });
    expect(variantForPage(1, config)).toBe('default');
    expect(variantForPage(2, config)).toBe('even');
    expect(variantForPage(3, config)).toBe('default');
    expect(variantForPage(4, config)).toBe('even');
  });

  it('lets the first page win over odd/even on page 1', () => {
    const config = configWith({ differentFirstPage: true, differentEvenOdd: true });
    expect(variantForPage(1, config)).toBe('first');
    expect(variantForPage(2, config)).toBe('even');
    expect(variantForPage(3, config)).toBe('default');
  });

  it('keeps content typed into a hidden variant when its switch goes off', () => {
    let config = configWith({ differentFirstPage: true });
    config = setSlot(config, 'first', 'header', 'center', 'Title page');
    config = { ...config, differentFirstPage: false };

    expect(variantForPage(1, config)).toBe('default');
    // Hidden, not discarded — turning the switch back on brings it back.
    expect(config.variants.first.header.center).toBe('Title page');
    expect(variantForPage(1, { ...config, differentFirstPage: true })).toBe('first');
  });
});

describe('variantLabel', () => {
  it('calls the default variant "Header" until there is an even one to contrast', () => {
    const plain = defaultHeaderFooterConfig();
    expect(variantLabel('default', 'header', plain)).toBe('Header');
    expect(variantLabel('default', 'footer', plain)).toBe('Footer');

    const split = configWith({ differentEvenOdd: true });
    expect(variantLabel('default', 'header', split)).toBe('Odd page header');
  });

  it('names the first-page and even variants', () => {
    const config = configWith({ differentFirstPage: true, differentEvenOdd: true });
    expect(variantLabel('first', 'header', config)).toBe('First page header');
    expect(variantLabel('even', 'footer', config)).toBe('Even page footer');
  });
});

describe('resolveFields', () => {
  const ctx = { page: 3, pages: 12, title: 'Quarterly report', date: new Date(2026, 0, 15) };

  it('resolves each field against the page it is rendered on', () => {
    expect(resolveFields('Page {{page}} of {{pages}}', ctx)).toBe('Page 3 of 12');
    expect(resolveFields('{{title}}', ctx)).toBe('Quarterly report');
    expect(resolveFields('{{date}}', ctx)).toBe(new Date(2026, 0, 15).toLocaleDateString());
  });

  it('resolves repeated tokens and tolerates whitespace inside them', () => {
    expect(resolveFields('{{page}}/{{ page }}', ctx)).toBe('3/3');
  });

  it('leaves text with no tokens alone', () => {
    expect(resolveFields('Confidential', ctx)).toBe('Confidential');
    expect(resolveFields('', ctx)).toBe('');
  });

  // A band reads the document's codes, not a private list of four — which is
  // what lets one autocomplete serve the bands and the body alike.
  it('resolves the metadata codes out of the document properties', () => {
    const properties = { ...emptyDocProperties(), author: 'Ada Lovelace' };
    expect(resolveFields('{{author}}', { ...ctx, properties })).toBe('Ada Lovelace');
  });

  it('falls back to the text after the colon when a property is empty', () => {
    expect(resolveFields('{{author:My Self}}', ctx)).toBe('My Self');
  });

  it('resolves a custom property', () => {
    const properties = { ...emptyDocProperties(), custom: { client: 'Initech' } };
    expect(resolveFields('For {{client}}', { ...ctx, properties })).toBe('For Initech');
  });

  it('accepts an alias, as the body does', () => {
    expect(resolveFields('{{page-number}}', ctx)).toBe('3');
  });

  it('removes a token that resolves to nothing', () => {
    // A band is plain text, so an unresolved token has no chrome to mark it as
    // unfinished — printed, it would just be braces across the top of every
    // page. The body shows the code instead, where you can click it.
    expect(resolveFields('By {{author}}', ctx)).toBe('By ');
  });

  it('still resolves the page codes for a caller with no properties at all', () => {
    // The PDF export builds its bands without them.
    expect(resolveFields('Page {{page}}', { page: 3, pages: 12, title: '' })).toBe('Page 3');
  });
});

describe('editing helpers', () => {
  it('setSlot touches only the slot it is given', () => {
    const before = defaultHeaderFooterConfig();
    const after = setSlot(before, 'even', 'footer', 'right', 'x');

    expect(after.variants.even.footer.right).toBe('x');
    expect(after.variants.even.footer.left).toBe('');
    expect(after.variants.even.header).toEqual(before.variants.even.header);
    expect(after.variants.default).toEqual(before.variants.default);
    // The caller renders from the returned value; mutating in place would leave
    // React with an unchanged reference and no re-render.
    expect(before.variants.even.footer.right).toBe('');
  });

  it('clearBand empties one band and leaves its partner', () => {
    let config = setSlot(defaultHeaderFooterConfig(), 'default', 'header', 'left', 'a');
    config = setSlot(config, 'default', 'footer', 'left', 'b');
    const cleared = clearBand(config, 'default', 'header');

    expect(cleared.variants.default.header).toEqual({ left: '', center: '', right: '' });
    expect(cleared.variants.default.footer.left).toBe('b');
  });

  it('hasAnyContent ignores variants that are switched off', () => {
    const config = setSlot(defaultHeaderFooterConfig(), 'first', 'header', 'left', 'Cover');
    expect(hasAnyContent(config)).toBe(false);
    expect(hasAnyContent({ ...config, differentFirstPage: true })).toBe(true);
  });
});

describe('legacy documents', () => {
  it('migrates the old flat strings into the default variant, left-aligned', () => {
    const config = migrateLegacyHeaderFooter('Draft', 'Page {{page}}', true);
    expect(config.variants.default.header.left).toBe('Draft');
    expect(config.variants.default.footer.left).toBe('Page {{page}}');
    expect(config.differentFirstPage).toBe(false);
    expect(config.differentEvenOdd).toBe(false);
  });

  it('strips the page token when the old showPageNumbers flag was off', () => {
    // It used to render literally as "{{page}}", which was never the intent.
    const config = migrateLegacyHeaderFooter('', 'Page {{page}}', false);
    expect(config.variants.default.footer.left).toBe('Page');
  });

  it('writes the legacy fields back so an older build still shows something', () => {
    let config = setSlot(defaultHeaderFooterConfig(), 'default', 'header', 'left', 'Draft');
    config = setSlot(config, 'default', 'footer', 'right', 'Page {{page}}');
    const legacy = legacyFieldsFor(config);

    expect(legacy.headerText).toBe('Draft');
    expect(legacy.footerText).toBe('Page {{page}}');
    expect(legacy.showPageNumbers).toBe(true);
  });

  it('round-trips a config through storage', () => {
    let config = setSlot(defaultHeaderFooterConfig(), 'even', 'header', 'left', '{{page}}');
    config = { ...config, differentEvenOdd: true, headerMargin: 18 };
    expect(normalizeHeaderFooterConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  });

  it('defaults every missing or malformed field rather than throwing', () => {
    const fallback = defaultHeaderFooterConfig();
    expect(normalizeHeaderFooterConfig(undefined)).toEqual(fallback);
    expect(normalizeHeaderFooterConfig({ variants: { default: { header: { left: 5 } } } }))
      .toEqual(fallback);
    expect(normalizeHeaderFooterConfig({ headerMargin: -3 }).headerMargin)
      .toBe(fallback.headerMargin);
  });
});
