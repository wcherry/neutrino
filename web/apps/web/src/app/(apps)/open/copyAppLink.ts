import { appLinkUrl, MIME_FOR_KIND, type AppLinkKind } from './appLink';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The most specific link kind for a file: its own app's (`/open/sheet/<id>`) when it is one of
 * the apps' native formats, so a phone opens that app, and `file` otherwise.
 */
export function appLinkKindForMime(mimeType: string): AppLinkKind {
  const match = (Object.entries(MIME_FOR_KIND) as [AppLinkKind, string][]).find(([, mime]) => mime === mimeType);
  return match ? match[0] : 'file';
}

/**
 * Copies a file's `/open/<kind>/<id>` link. The plain text is the URL alone, which pastes as a
 * link anywhere; alongside it goes an HTML anchor carrying the title, as a browser's own "Copy
 * link" does, so a Markdown editor such as Neutrino Atlas can paste `[Title](url)`.
 *
 * Only the title and the file id travel — never a download URL, which carries the session's
 * access token and would hand it to whoever the link is pasted to.
 */
export async function copyAppLink(
  kind: AppLinkKind,
  id: string,
  title: string,
  origin: string = window.location.origin,
): Promise<string> {
  const url = appLinkUrl(kind, id, origin);
  const html = `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`;
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([url], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return url;
    } catch {
      // Some browsers refuse HTML on the clipboard; the URL alone is still the link.
    }
  }
  await navigator.clipboard.writeText(url);
  return url;
}
