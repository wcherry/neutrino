'use client';

import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NspellHandle {
  /** Returns true if the word is spelled correctly. */
  check: (word: string) => boolean;
  /** Returns an array of spelling suggestions for the given word. */
  suggest: (word: string) => string[];
}

// ── Module-level singleton ────────────────────────────────────────────────────
// The nspell instance is expensive to create (it parses a ~550 KB dictionary).
// Keep it at module scope so it is initialised at most once per page session,
// regardless of how many components call useNspell().

let cachedHandle: NspellHandle | null = null;
let loadPromise: Promise<NspellHandle | null> | null = null;

async function loadNspell(): Promise<NspellHandle | null> {
  if (cachedHandle) return cachedHandle;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      // Fetch the dictionary files as binary data from the public directory.
      // This avoids any Node.js fs dependency and works in all browsers.
      const [affRes, dicRes] = await Promise.all([
        fetch('/dictionaries/en/index.aff'),
        fetch('/dictionaries/en/index.dic'),
      ]);

      if (!affRes.ok || !dicRes.ok) {
        throw new Error('Failed to fetch dictionary files');
      }

      const [affBuffer, dicBuffer] = await Promise.all([
        affRes.arrayBuffer(),
        dicRes.arrayBuffer(),
      ]);

      // nspell is a CommonJS module — import it dynamically to keep it out of
      // the initial bundle and to allow lazy loading on first right-click.
      const { default: NSpell } = await import('nspell');

      const spell = NSpell(
        Buffer.from(affBuffer),
        Buffer.from(dicBuffer),
      );

      cachedHandle = {
        check: (word: string) => spell.correct(word),
        suggest: (word: string) => spell.suggest(word),
      };

      return cachedHandle;
    } catch {
      // Dictionary load failed — swallow the error and return null so callers
      // can degrade gracefully (e.g. show no suggestions rather than crashing).
      loadPromise = null; // allow retry on next invocation
      return null;
    }
  })();

  return loadPromise;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useNspell
 *
 * Lazily loads the English Hunspell dictionary and returns an nspell handle.
 * Returns null until the dictionary is loaded.
 *
 * The nspell instance is cached at module level so it is only initialised once
 * per page session, regardless of how many components call this hook.
 *
 * @returns NspellHandle | null
 */
export function useNspell(): NspellHandle | null {
  const [handle, setHandle] = useState<NspellHandle | null>(cachedHandle);

  useEffect(() => {
    if (cachedHandle) {
      setHandle(cachedHandle);
      return;
    }

    let cancelled = false;
    loadNspell().then((result) => {
      if (!cancelled) setHandle(result);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return handle;
}
