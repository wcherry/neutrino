/**
 * The web half of the Neutrino Universal Link format.
 *
 * `https://www.getneutrino.app/open/<kind>/<file id>` opens a Drive file in whichever iOS app owns
 * its format. On a device without that app — and in every desktop browser — the same URL lands
 * here instead, which is the entire reason these are `https` links rather than a custom
 * `neutrinonotes://` scheme.
 *
 * This page is therefore a pure redirector: it maps the link's `kind` to the editor that already
 * exists for that format and gets out of the way.
 *
 * > The link vocabulary is duplicated in `NeutrinoAppLink.swift` in the three iOS repositories, and
 * > the path patterns are claimed in `static/apple-app-site-association`. All three have to agree:
 * > a `kind` added here without a matching AASA entry opens Safari instead of the app, and one
 * > added to the AASA without a case here lands the user on an error page.
 */

import {
  hrefForFile,
  DOC_MIME,
  SHEET_MIME,
  SLIDES_MIME,
  DIAGRAM_MIME,
  DRAWING_MIME,
  NOTE_MIME,
} from '../drive/routeForFile';
import { DRIVE_PREVIEW_PARAM } from '../drive/searchParams';

/** Every `/open/<kind>/…` path the apps mint. `file` means "whatever this is, open it in Drive". */
export const APP_LINK_KINDS = ['file', 'note', 'doc', 'sheet', 'slide', 'diagram', 'drawing'] as const;

export type AppLinkKind = (typeof APP_LINK_KINDS)[number];

/** The MIME each kind stands for. `file` is absent: it is a property of the link, not a format. */
export const MIME_FOR_KIND: Record<Exclude<AppLinkKind, 'file'>, string> = {
  note: NOTE_MIME,
  doc: DOC_MIME,
  sheet: SHEET_MIME,
  slide: SLIDES_MIME,
  diagram: DIAGRAM_MIME,
  drawing: DRAWING_MIME,
};

export function isAppLinkKind(value: string): value is AppLinkKind {
  return (APP_LINK_KINDS as readonly string[]).includes(value);
}

/** Drive's file listing with the preview for `id` already open. */
export function drivePreviewHref(id: string): string {
  return `/drive?${DRIVE_PREVIEW_PARAM}=${encodeURIComponent(id)}`;
}

/**
 * Where a link should land, given the file's MIME type.
 *
 * Delegates to `hrefForFile` so a link opens exactly where a click in Drive would — there is no
 * second routing table to drift. The one difference is the fallback: a file with no editor becomes
 * a Drive preview of *that file*, rather than the bare listing `hrefForFile` returns for callers
 * that only need a link.
 */
export function hrefForMime(id: string, mimeType: string): string {
  const href = hrefForFile({ id, mimeType });
  return href === '/drive' ? drivePreviewHref(id) : href;
}

/**
 * Where a `/open/<kind>/<id>` link should land, when the kind alone is enough to say.
 *
 * Returns `null` for `kind === 'file'`, which carries no format: the caller has to ask the server
 * what the file actually is before it can route.
 */
export function hrefForKind(kind: AppLinkKind, id: string): string | null {
  if (kind === 'file') return null;
  return hrefForMime(id, MIME_FOR_KIND[kind]);
}
