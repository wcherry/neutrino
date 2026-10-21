'use client';

import { useEffect, useCallback } from 'react';
import { preferences, usePreference } from '@neutrino/preferences';

/**
 * useSpellCheck
 *
 * The user's spell-check preference across Docs, Slides, and Sheets editors — the synced
 * `docs.spellCheck` preference (`@neutrino/preferences`), on by default.
 *
 * Also registers a Cmd+Shift+; (macOS) / Ctrl+Shift+; (other platforms) keyboard shortcut that
 * toggles the preference.
 *
 * @returns { spellCheck, toggle }
 *   spellCheck — current boolean state (true = enabled)
 *   toggle     — stable callback that flips the state and persists the new value
 */
export function useSpellCheck(): { spellCheck: boolean; toggle: () => void } {
    const [spellCheck] = usePreference('docs.spellCheck');

    // Reads the store rather than the render's value, so a stable callback never flips a stale one.
    const toggle = useCallback(() => {
        preferences.set('docs.spellCheck', !preferences.get('docs.spellCheck'));
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const isModifier = e.metaKey || e.ctrlKey;
            if (isModifier && e.shiftKey && e.key === ';') {
                e.preventDefault();
                toggle();
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [toggle]);

    return { spellCheck, toggle };
}
