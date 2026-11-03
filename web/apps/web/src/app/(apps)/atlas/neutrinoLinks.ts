import { APP_LINK_KINDS, appLinkUrl, isAppLinkKind, type AppLinkKind } from '../open/appLink';
import { OOXML_MIME } from '@/lib/officeFormats';

/**
 * Links from an Atlas page to other Neutrino files: `https://www.getneutrino.app/open/<kind>/<id>`,
 * the links every app mints (`open/appLink.ts`, `NeutrinoAppLink.swift`), or the same on this
 * deployment's origin (a development server mints links on its own origin). The Mac app's
 * `neutrinoDestination`, `linkChip` and `markdownLink`.
 */

const HOSTS = ['www.getneutrino.app', 'getneutrino.app'];

export interface Destination {
  kind: AppLinkKind;
  fileID: string;
}

/** The file a link opens, when it's a Neutrino link; null for any other URL. */
export function neutrinoDestination(url: string, origin: string = window.location.origin): Destination | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const own = parsed.origin === new URL(origin).origin;
  if (!own && !(parsed.protocol === 'https:' && HOSTS.includes(parsed.hostname.toLowerCase()))) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 3 || segments[0] !== 'open' || !isAppLinkKind(segments[1])) return null;
  const fileID = decodeURIComponent(segments[2]).trim();
  return fileID === '' ? null : { kind: segments[1], fileID };
}

/** The kinds' MIME types, each generation of them (`NeutrinoAppLink.Kind.mimeTypes`). */
const MIMES: Record<Exclude<AppLinkKind, 'file'>, string[]> = {
  note: ['text/markdown'],
  doc: [OOXML_MIME.docx, 'application/x-neutrino-doc', 'application/vnd.neutrino.doc'],
  sheet: [OOXML_MIME.xlsx, 'application/x-neutrino-sheet', 'application/vnd.neutrino.sheet'],
  slide: [OOXML_MIME.pptx, 'application/x-neutrino-slide', 'application/vnd.neutrino.slide'],
  diagram: ['application/x-neutrino-diagram', 'application/vnd.neutrino.diagram'],
  drawing: ['application/x-neutrino-drawing', 'application/vnd.neutrino.drawing'],
};

/** The app that owns `mimeType`, or `file` when no Neutrino editor claims it. */
export function kindForMime(mimeType: string | null | undefined): AppLinkKind {
  const normalized = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  return (APP_LINK_KINDS.find((k) => k !== 'file' && MIMES[k].includes(normalized)) as AppLinkKind | undefined) ?? 'file';
}

/**
 * A Markdown link to a Drive file, `[Name](<origin>/open/<kind>/<id>)`, as the web mints them.
 * Notes, Docs, Sheets and Slides drop their extension from the name.
 */
export function markdownLinkTo(file: { id: string; name: string; mimeType?: string | null }, origin: string = window.location.origin): string {
  const kind = kindForMime(file.mimeType);
  let name = file.name;
  const dot = name.lastIndexOf('.');
  if (kind !== 'file' && dot > 0) name = name.slice(0, dot);
  const label = [...name].map((c) => ('\\[]*_`'.includes(c) ? '\\' + c : c)).join('');
  return `[${label}](${appLinkUrl(kind, file.id, origin)})`;
}
