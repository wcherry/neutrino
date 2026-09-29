'use client';

/**
 * One editor mount per document (issue #214).
 *
 * Every editor route here is `/<app>/editor?id=<fileId>`, so opening a second
 * document of the same kind is a change of *search params* on the same route —
 * and the App Router reconciles that as the same element. The editor component
 * is therefore not remounted: it re-renders with a new `id` while still holding
 * the previous document's state. All of it. The grid or canvas on screen, the
 * file metadata the next save writes under, the undo history, the stored OOXML
 * package, and the content-version guard.
 *
 * What the user saw was the guard, because it is the one piece that reports
 * itself: it holds the revision of the document it loaded and `observe` only
 * ever moves forward, so a brand-new file (`content_version` 1) could not
 * displace the open one's higher number. The very first autosave against the
 * new id then sent a version the server had never issued for it, was refused
 * 409, and warned that "this spreadsheet changed elsewhere" about a file created
 * a second earlier. Behind that message the worse half: the new document never
 * received its first body, and the editor went on showing — and was one
 * successful save away from writing — the previous document's content into it.
 *
 * Keying the editor on the id makes a different document a different mount,
 * which is what every piece of state in those components already assumes. The
 * outgoing instance unmounts with its own id still in scope, so its
 * flush-on-unmount save lands on the document it was editing.
 */

import { useSearchParams } from 'next/navigation';

/**
 * Mounts `editor` keyed on the current `?id=`.
 *
 * It takes the component rather than an element or a render prop because the
 * key has to go on the editor itself — a key on something *containing* it would
 * be reconciled by position, exactly as the route is today — and every page
 * here is a server component, which may hand a client component across as a
 * reference but cannot hand over a function to call.
 */
export function EditorSession({ editor: Editor }: { editor: React.ComponentType }) {
  const id = useSearchParams().get('id') ?? '';
  return <Editor key={id} />;
}
