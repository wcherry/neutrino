import { copyAppLink } from '../open/copyAppLink';

/**
 * Copies a note's link (`/open/note/<id>`) — see `copyAppLink`. Only the title and the file id
 * travel: the title is the note's name, which is the one thing about a note that isn't end-to-end
 * encrypted.
 */
export function copyNoteLink(id: string, title: string, origin: string = window.location.origin): Promise<string> {
  return copyAppLink('note', id, title.trim() || 'Untitled note', origin);
}
