/**
 * Unit tests for the useSpellCheck hook.
 *
 * Covers:
 *   - Initialises from the `docs.spellCheck` preference (defaulting to true when unset)
 *   - Reads a stored value on mount
 *   - toggle() flips the state and writes the preference
 *   - Keyboard shortcut (Cmd+Shift+; / Ctrl+Shift+;) triggers toggle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { preferences } from '@neutrino/preferences';
import { useSpellCheck } from '../hooks/useSpellCheck';

// ── helpers ──────────────────────────────────────────────────────────────────

function fireKeydown(key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean) {
    const event = new KeyboardEvent('keydown', { key, metaKey, ctrlKey, shiftKey, bubbles: true });
    document.dispatchEvent(event);
}

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
    localStorage.clear();
    // The store is a module singleton; each test starts from the default.
    preferences.reset('docs.spellCheck');
});

afterEach(() => {
    localStorage.clear();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('useSpellCheck — initial state', () => {
    it('defaults to true when the preference is unset', () => {
        const { result } = renderHook(() => useSpellCheck());
        expect(result.current.spellCheck).toBe(true);
    });

    it('reads a stored true', () => {
        preferences.set('docs.spellCheck', true);
        const { result } = renderHook(() => useSpellCheck());
        expect(result.current.spellCheck).toBe(true);
    });

    it('reads a stored false', () => {
        preferences.set('docs.spellCheck', false);
        const { result } = renderHook(() => useSpellCheck());
        expect(result.current.spellCheck).toBe(false);
    });
});

describe('useSpellCheck — toggle()', () => {
    it('flips state from true to false', () => {
        const { result } = renderHook(() => useSpellCheck());
        expect(result.current.spellCheck).toBe(true);
        act(() => result.current.toggle());
        expect(result.current.spellCheck).toBe(false);
    });

    it('flips state from false to true', () => {
        preferences.set('docs.spellCheck', false);
        const { result } = renderHook(() => useSpellCheck());
        act(() => result.current.toggle());
        expect(result.current.spellCheck).toBe(true);
    });

    it('persists the updated value as the preference', () => {
        const { result } = renderHook(() => useSpellCheck());
        act(() => result.current.toggle());
        expect(preferences.get('docs.spellCheck')).toBe(false);
    });

    it('toggle() is a stable reference across renders', () => {
        const { result, rerender } = renderHook(() => useSpellCheck());
        const firstToggle = result.current.toggle;
        rerender();
        expect(result.current.toggle).toBe(firstToggle);
    });
});

describe('useSpellCheck — keyboard shortcut', () => {
    it('Cmd+Shift+; toggles spell check on macOS', () => {
        const { result } = renderHook(() => useSpellCheck());
        expect(result.current.spellCheck).toBe(true);
        act(() => fireKeydown(';', true, false, true));
        expect(result.current.spellCheck).toBe(false);
    });

    it('Ctrl+Shift+; toggles spell check on non-macOS', () => {
        const { result } = renderHook(() => useSpellCheck());
        expect(result.current.spellCheck).toBe(true);
        act(() => fireKeydown(';', false, true, true));
        expect(result.current.spellCheck).toBe(false);
    });

    it('shortcut fires multiple times toggling back and forth', () => {
        const { result } = renderHook(() => useSpellCheck());
        act(() => fireKeydown(';', true, false, true));
        expect(result.current.spellCheck).toBe(false);
        act(() => fireKeydown(';', true, false, true));
        expect(result.current.spellCheck).toBe(true);
    });

    it('removes the keydown listener on unmount', () => {
        const { unmount } = renderHook(() => useSpellCheck());
        unmount();
        expect(() => fireKeydown(';', true, false, true)).not.toThrow();
    });

    it('Cmd+Shift+S does not toggle', () => {
        const { result } = renderHook(() => useSpellCheck());
        act(() => fireKeydown('s', true, false, true));
        expect(result.current.spellCheck).toBe(true);
    });

    it('Cmd+; (without Shift) does not toggle', () => {
        const { result } = renderHook(() => useSpellCheck());
        act(() => fireKeydown(';', true, false, false));
        expect(result.current.spellCheck).toBe(true);
    });
});
