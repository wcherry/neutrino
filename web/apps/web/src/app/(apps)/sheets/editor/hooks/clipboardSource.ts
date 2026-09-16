/**
 * Where a paste should read its content from.
 *
 * The editor keeps an in-memory clipboard (`clipboardRef`) because the rich
 * internal format carries things plain text cannot — relative formula encoding,
 * per-cell styles, conditional-format rules. What it must never do is stand in
 * for the *system* clipboard: it is only ever cleared after a cut, so once
 * anything has been copied inside the sheet it stays set for the rest of the
 * session, and a paste that consulted it first would replay that same content
 * forever while the user copied other things from other applications.
 *
 * A clipboard event knows what is actually on the clipboard right now, so the
 * event decides and the in-memory copy is used only to *carry* the internal
 * payload the event announced.
 */

/** The custom MIME type carrying the editor's own rich clipboard payload. */
export const NEUTRINO_SHEET_MIME = 'application/x-neutrino-sheet';

export type ClipboardSource =
    /** Copied from this editor — the rich payload is on the clipboard. */
    | 'internal'
    /** Copied from somewhere else — Google Sheets, Excel, a text editor. */
    | 'external'
    /** Nothing readable on the event; fall back to whatever is in memory. */
    | 'empty';

/**
 * Classifies a paste from the MIME types its `DataTransfer` advertises.
 *
 * `empty` is deliberately distinct from `external`: a synthetic or permission-
 * blocked event carries no types at all, and treating that as an external paste
 * would discard a legitimate internal clipboard for a paste that has nothing to
 * put in its place.
 */
export function clipboardSource(types: readonly string[] | undefined): ClipboardSource {
    if (!types || types.length === 0) return 'empty';
    return types.includes(NEUTRINO_SHEET_MIME) ? 'internal' : 'external';
}
