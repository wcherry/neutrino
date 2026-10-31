import { appLinkUrl } from '../open/appLink';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Copies a note's link (`/open/note/<id>`). The plain text is the URL alone, which pastes as a
 * link anywhere; alongside it goes an HTML anchor carrying the note's title, as a browser's own
 * "Copy link" does, so a Markdown editor such as Neutrino Atlas can paste `[Title](url)`.
 *
 * Only the title and the file id travel: the title is the note's name, which is the one thing
 * about a note that isn't end-to-end encrypted.
 */
export async function copyNoteLink(id: string, title: string, origin: string = window.location.origin): Promise<string> {
  const url = appLinkUrl('note', id, origin);
  const html = `<a href="${escapeHtml(url)}">${escapeHtml(title.trim() || 'Untitled note')}</a>`;
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
