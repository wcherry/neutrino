/**
 * The stored shape of a Neutrino doc's body, and the layout metadata that
 * rides in it.
 *
 * Content is stored as a wrapper object `{ doc: TiptapJSON, _meta: LayoutMeta }`
 * whenever there is metadata to keep, and as plain Tiptap JSON when there is
 * not — which is what a document with no header, footer, watermark, theme or
 * custom page setup has always been stored as. Headers and footers are not
 * behind a feature flag, so the wrapper cannot be conditioned on one: a header
 * typed into a document must survive its next save whatever the flags say.
 *
 * These live here rather than in `DocEditor` so they can be tested without
 * standing up the editor — reading them wrong is how a document full of text
 * ends up saved as an empty one.
 */

import { DEFAULT_PAGE_SETUP, type PageSetup } from '@neutrino/api-docs';
import { hasAnyContent, type HeaderFooterConfig } from '@/lib/docHeaderFooter';
import { hasDocProperties, type DocProperties } from '@/lib/docFields';
// Type-only, so this does not pull the modal (or React) into anything that
// imports this module.
import type { DocTheme } from '@/app/(apps)/docs/editor/ThemeModal';

export interface LayoutMeta {
  /**
   * The header and footer model. `headerText` / `footerText` /
   * `showPageNumbers` beside it are the flattened legacy view of the default
   * variant, still written so a build without this feature opens the document
   * showing something rather than nothing — see `legacyFieldsFor`.
   */
  headerFooter: HeaderFooterConfig;
  headerText: string;
  footerText: string;
  showPageNumbers: boolean;
  watermarkText: string;
  bgColor: string;
  docTheme: DocTheme;
  /**
   * Author, subject, company and the rest — the values `{{author}}` and the
   * other metadata field codes read. Part of the document rather than of the
   * account, because on a shared document the person who opened it is routinely
   * not the person who wrote it.
   */
  properties: DocProperties;
  /**
   * Margins, orientation and page size. This used to be server-side state with
   * its own endpoint, which made it the one part of a document's layout the
   * server could read; it lives here now, inside the E2EE body, and a document
   * stored without it opens at `DEFAULT_PAGE_SETUP`.
   */
  pageSetup: PageSetup;
}

export function isDefaultPageSetup(ps: PageSetup): boolean {
  return (Object.keys(DEFAULT_PAGE_SETUP) as (keyof PageSetup)[])
    .every((k) => ps[k] === DEFAULT_PAGE_SETUP[k]);
}

/**
 * The page setup a stored `_meta` block calls for.
 *
 * `pageSetup` is absent from any document last saved while page setup was
 * still server state, and from one whose margins were never customised — the
 * same fallback covers both. Merged field-by-field rather than taken whole so
 * a partial block (a future field added, an older one dropped) still yields a
 * complete `PageSetup` instead of margins that read `undefined` and lay the
 * page out at NaN.
 */
export function pageSetupFromMeta(meta: { pageSetup?: Partial<PageSetup> } | null | undefined): PageSetup {
  return { ...DEFAULT_PAGE_SETUP, ...(meta?.pageSetup ?? {}) };
}

/** Whether `meta` holds anything worth the wrapper. */
export function hasLayoutMeta(meta: LayoutMeta): boolean {
  return (
    hasAnyContent(meta.headerFooter) ||
    Boolean(meta.watermarkText) ||
    Boolean(meta.bgColor) ||
    meta.docTheme !== 'default' ||
    hasDocProperties(meta.properties) ||
    !isDefaultPageSetup(meta.pageSetup)
  );
}

export function serializeContent(
  docJson: object,
  meta: LayoutMeta,
  layoutStructure: boolean,
): string {
  // The flag still forces the wrapper on, so documents that have been stored
  // that way keep their shape even after their metadata is cleared out.
  if (layoutStructure || hasLayoutMeta(meta)) {
    return JSON.stringify({ doc: docJson, _meta: meta });
  }
  return JSON.stringify(docJson);
}
