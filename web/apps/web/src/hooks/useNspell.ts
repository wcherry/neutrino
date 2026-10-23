'use client';

import { useState, useEffect } from 'react';
import { callEditorWorker, hasEditorWorker } from '@/lib/workers/editorWorkerClient';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NspellHandle {
  /**
   * Returns true if the word is spelled correctly. Synchronous, so a decoration pass can call it
   * per word: with the dictionary in the worker, a word not seen yet counts as correct until its
   * answer arrives, and `onChange` then says to look again.
   */
  check: (word: string) => boolean;
  /** The definite answer, waiting for the worker where it has to. */
  checkAsync?: (word: string) => Promise<boolean>;
  /** Spelling suggestions for the given word. */
  suggest: (word: string) => string[] | Promise<string[]>;
  /** Called when answers arrive that turn a word `check` passed into a misspelling. */
  onChange?: (listener: () => void) => () => void;
}

/** Suggestions for `word`, or none when it is spelled correctly. */
export async function spellSuggestionsFor(handle: NspellHandle, word: string, limit = Infinity): Promise<string[]> {
  const correct = handle.checkAsync ? await handle.checkAsync(word) : handle.check(word);
  if (correct) return [];
  return (await handle.suggest(word)).slice(0, limit);
}

/** The first misspelled word in `text`, if any. */
export async function firstMisspelledWord(handle: NspellHandle, text: string): Promise<string | null> {
  for (const word of text.match(/[a-zA-Z']+/g) ?? []) {
    const correct = handle.checkAsync ? await handle.checkAsync(word) : handle.check(word);
    if (!correct) return word;
  }
  return null;
}

/**
 * A handle over the editor worker. Answers are kept per word — a document has a few thousand
 * distinct words, so after the first pass every check is a lookup — and the words a pass asks
 * about are sent in one batch at the end of the task.
 */
function workerHandle(): NspellHandle {
  const verdicts = new Map<string, boolean>();
  const waiting = new Map<string, Promise<boolean>>();
  const listeners = new Set<() => void>();
  let batch: { words: string[]; answers: Promise<boolean[]> } | null = null;

  const send = (words: string[]) =>
    callEditorWorker('spell.check', { words }).then(
      (result) => {
        let turned = false;
        words.forEach((w, i) => {
          verdicts.set(w, result[i]);
          waiting.delete(w);
          if (!result[i]) turned = true;
        });
        if (turned) listeners.forEach((l) => l());
        return result;
      },
      (err: unknown) => {
        words.forEach((w) => waiting.delete(w));
        throw err;
      },
    );

  const ask = (word: string): Promise<boolean> => {
    const known = verdicts.get(word);
    if (known !== undefined) return Promise.resolve(known);
    const inFlight = waiting.get(word);
    if (inFlight) return inFlight;
    if (!batch) {
      // Collected for the rest of this task, then sent together.
      const words: string[] = [];
      const answers = new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
        batch = null;
        return send(words);
      });
      batch = { words, answers };
    }
    const index = batch.words.push(word) - 1;
    // A worker that cannot answer flags nothing, as a dictionary that never loaded did.
    const answer = batch.answers.then((all) => all[index], () => true);
    waiting.set(word, answer);
    return answer;
  };

  return {
    check: (word) => {
      const known = verdicts.get(word);
      if (known !== undefined) return known;
      void ask(word);
      return true;
    },
    checkAsync: ask,
    suggest: (word) => callEditorWorker('spell.suggest', { word }).catch(() => []),
    onChange: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
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
    // In the worker where there is one (UI roadmap P6): building the dictionary is a quarter of a
    // second of main thread at 4× CPU, and it used to land the moment an editor opened.
    if (hasEditorWorker()) {
      try {
        await callEditorWorker('spell.load', {});
        cachedHandle = workerHandle();
        return cachedHandle;
      } catch {
        // fall back to the page
      }
    }
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
