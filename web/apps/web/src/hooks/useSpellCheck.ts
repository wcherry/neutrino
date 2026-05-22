'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'neutrino.spellCheck';

/**
 * Reads the persisted spell-check preference from localStorage.
 * Returns true (on) by default when no value is stored.
 * Guards against SSR where localStorage is unavailable.
 */
function readStored(): boolean {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return true;
    return stored !== 'false';
}

/**
 * useSpellCheck
 *
 * Manages the user's spell-check preference across Docs, Slides, and Sheets
 * editors. State is persisted in localStorage so it survives page refreshes.
 *
 * When the `feature.editors.spellCheck` flag is enabled the hook also registers
 * a Cmd+Shift+; (macOS) / Ctrl+Shift+; (other platforms) keyboard shortcut that
 * toggles the preference.
 *
 * @returns { spellCheck, toggle }
 *   spellCheck — current boolean state (true = enabled)
 *   toggle     — stable callback that flips the state and persists the new value
 */
export function useSpellCheck(): { spellCheck: boolean; toggle: () => void } {
    const [spellCheck, setSpellCheck] = useState<boolean>(readStored);

    const toggle = useCallback(() => {
        setSpellCheck((prev) => {
            const next = !prev;
            if (typeof window !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, String(next));
            }
            return next;
        });
    }, []);

    // Register the keyboard shortcut only when the feature flag is on.
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
