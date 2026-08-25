/**
 * Regression tests: page setup lives in the document body.
 *
 * It used to be server-side state behind `GET`/`PUT /api/v1/docs/{id}/page-setup`,
 * which made margins the one part of a document's layout readable on a server
 * that cannot decrypt the document itself. It is now a field in the `_meta`
 * block beside the header/footer, watermark and theme settings, so it is inside
 * the E2EE payload.
 *
 * Two properties matter and both are silent when broken. A document with
 * customised margins must take the *wrapper* form on save, or the margins are
 * dropped on the next round-trip with nothing to show for it. And a document
 * stored without `pageSetup` — every document written before the move, plus
 * every one whose margins were never touched — must read back as the default
 * rather than as `undefined`, which lays the page out at NaN.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PAGE_SETUP, type PageSetup } from '@neutrino/api-docs';
import { emptyDocProperties } from '@/lib/docFields';
import { defaultHeaderFooterConfig, legacyFieldsFor } from '@/lib/docHeaderFooter';
import {
  hasLayoutMeta,
  isDefaultPageSetup,
  pageSetupFromMeta,
  serializeContent,
  type LayoutMeta,
} from '@/lib/docBody';

const DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const CUSTOM: PageSetup = {
  marginTop: 36, marginBottom: 36, marginLeft: 54, marginRight: 54,
  orientation: 'landscape', pageSize: 'a4',
};

/** One differing value per field, so each is checked on its own. */
const CUSTOM_FOR: { [K in keyof PageSetup]: Partial<PageSetup> } = {
  marginTop: { marginTop: 36 },
  marginBottom: { marginBottom: 36 },
  marginLeft: { marginLeft: 54 },
  marginRight: { marginRight: 54 },
  orientation: { orientation: 'landscape' },
  pageSize: { pageSize: 'a4' },
};

function meta(overrides: Partial<LayoutMeta> = {}): LayoutMeta {
  const headerFooter = overrides.headerFooter ?? defaultHeaderFooterConfig();
  return {
    headerFooter,
    ...legacyFieldsFor(headerFooter),
    watermarkText: '',
    bgColor: '',
    docTheme: 'default',
    properties: emptyDocProperties(),
    pageSetup: DEFAULT_PAGE_SETUP,
    ...overrides,
  };
}

function parse(raw: string) {
  return JSON.parse(raw) as { doc?: unknown; _meta?: { pageSetup?: PageSetup } };
}

describe('isDefaultPageSetup', () => {
  it('accepts the default itself', () => {
    expect(isDefaultPageSetup(DEFAULT_PAGE_SETUP)).toBe(true);
  });

  it('accepts a distinct object with the same values', () => {
    expect(isDefaultPageSetup({ ...DEFAULT_PAGE_SETUP })).toBe(true);
  });

  it('rejects a change to any single field', () => {
    for (const key of Object.keys(DEFAULT_PAGE_SETUP) as (keyof PageSetup)[]) {
      const changed: PageSetup = { ...DEFAULT_PAGE_SETUP, ...CUSTOM_FOR[key] };
      expect(isDefaultPageSetup(changed), `${key} should not read as default`).toBe(false);
    }
  });
});

describe('pageSetupFromMeta', () => {
  it('falls back to the default for a document stored before page setup moved into the body', () => {
    expect(pageSetupFromMeta({})).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('falls back to the default for a bare document with no _meta at all', () => {
    expect(pageSetupFromMeta(undefined)).toEqual(DEFAULT_PAGE_SETUP);
    expect(pageSetupFromMeta(null)).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('reads a stored page setup back whole', () => {
    expect(pageSetupFromMeta({ pageSetup: CUSTOM })).toEqual(CUSTOM);
  });

  it('completes a partial block from the default rather than yielding undefined margins', () => {
    const read = pageSetupFromMeta({ pageSetup: { orientation: 'landscape' } });
    expect(read.orientation).toBe('landscape');
    expect(read.marginTop).toBe(DEFAULT_PAGE_SETUP.marginTop);
    expect(Object.values(read).every((v) => v !== undefined)).toBe(true);
  });

  it('does not mutate the shared default', () => {
    pageSetupFromMeta({ pageSetup: CUSTOM });
    expect(DEFAULT_PAGE_SETUP.orientation).toBe('portrait');
    expect(DEFAULT_PAGE_SETUP.marginTop).toBe(72);
  });
});

describe('hasLayoutMeta', () => {
  it('is false for a document that has customised nothing', () => {
    expect(hasLayoutMeta(meta())).toBe(false);
  });

  it('is true once page setup differs from the default', () => {
    expect(hasLayoutMeta(meta({ pageSetup: CUSTOM }))).toBe(true);
  });

  it('stays true for the metadata that already earned the wrapper', () => {
    expect(hasLayoutMeta(meta({ watermarkText: 'DRAFT' }))).toBe(true);
    expect(hasLayoutMeta(meta({ bgColor: '#eee' }))).toBe(true);
    expect(hasLayoutMeta(meta({ docTheme: 'corporate' }))).toBe(true);
  });
});

describe('serializeContent', () => {
  it('wraps a document with customised margins, and carries the page setup', () => {
    const stored = parse(serializeContent(DOC, meta({ pageSetup: CUSTOM }), false));
    expect(stored.doc).toEqual(DOC);
    expect(stored._meta?.pageSetup).toEqual(CUSTOM);
  });

  it('round-trips: what is written is what reads back', () => {
    const stored = parse(serializeContent(DOC, meta({ pageSetup: CUSTOM }), false));
    expect(pageSetupFromMeta(stored._meta)).toEqual(CUSTOM);
  });

  it('leaves a default document as bare Tiptap JSON, so it does not gain a _meta block', () => {
    // The iOS Docs app asserts the same property from the other side: a
    // document stored without `_meta` must not acquire one on a round-trip.
    const raw = serializeContent(DOC, meta(), false);
    expect(raw).not.toContain('_meta');
    expect(JSON.parse(raw)).toEqual(DOC);
  });

  it('still wraps a default document when the layout-structure flag forces it', () => {
    const stored = parse(serializeContent(DOC, meta(), true));
    expect(stored._meta?.pageSetup).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('writes page setup alongside other metadata rather than displacing it', () => {
    const raw = serializeContent(DOC, meta({ pageSetup: CUSTOM, watermarkText: 'DRAFT' }), false);
    const stored = JSON.parse(raw) as { _meta: LayoutMeta };
    expect(stored._meta.pageSetup).toEqual(CUSTOM);
    expect(stored._meta.watermarkText).toBe('DRAFT');
  });
});
