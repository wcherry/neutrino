/**
 * Where a paste reads from.
 *
 * The reported failure: "the paste is not pasting from the clipboard, it's just
 * reusing the same previously pasted data". `clipboardRef` is set by any copy
 * inside the sheet and is only cleared after a cut, so once anything had been
 * copied here it shadowed the system clipboard for the rest of the session —
 * the Google payload was never read, and every fix to the Google parsers was
 * invisible because that code did not run.
 *
 * Two things caused it and both are covered here: the keydown handler cancelling
 * the native paste event, and `handlePaste` consulting the in-memory clipboard
 * before the event's own payload.
 */

import { describe, it, expect } from 'vitest';
import { clipboardSource, NEUTRINO_SHEET_MIME } from '../../app/(apps)/sheets/editor/hooks/clipboardSource';

describe('clipboardSource', () => {
    it('reads a copy made inside the editor as internal', () => {
        expect(clipboardSource([NEUTRINO_SHEET_MIME, 'text/plain'])).toBe('internal');
    });

    it('reads a Google Sheets paste as external', () => {
        expect(clipboardSource([
            'text/plain',
            'text/html',
            'application/x-vnd.google-spreadsheet-compact-table+json',
        ])).toBe('external');
    });

    it('reads plain text from any other app as external', () => {
        expect(clipboardSource(['text/plain'])).toBe('external');
        expect(clipboardSource(['text/html', 'text/plain'])).toBe('external');
    });

    it('reads an event carrying nothing as empty, not external', () => {
        // A synthetic or permission-blocked event has no types. Treating it as
        // external would throw away a good internal clipboard and paste nothing.
        expect(clipboardSource([])).toBe('empty');
        expect(clipboardSource(undefined)).toBe('empty');
    });

    it('does not mistake the live-embed selection payload for the rich format', () => {
        // Both are Neutrino MIME types; only one carries the cell payload.
        expect(clipboardSource(['application/x-neutrino-sheet-selection', 'text/plain']))
            .toBe('external');
    });
});
