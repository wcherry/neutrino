'use client';

import { useCallback } from 'react';
import { useCommand } from '@neutrino/commands';
import { preferences, usePreference } from '@neutrino/preferences';

/**
 * useSpellCheck
 *
 * The user's spell-check preference across Docs, Slides, and Sheets editors — the synced
 * `docs.spellCheck` preference (`@neutrino/preferences`), on by default.
 *
 * Also runs the `editors.spellCheck.toggle` command (⌘⇧; / Ctrl+Shift+; unless remapped in
 * Settings › Keyboard), which toggles the preference.
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

    useCommand('editors.spellCheck.toggle', toggle);

    return { spellCheck, toggle };
}
