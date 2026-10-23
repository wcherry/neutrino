/// <reference lib="webworker" />
/**
 * The editors' worker (UI roadmap P6): the work that used to hold the main thread for a long stretch
 * and needs nothing from the page.
 *
 * - Sealing and opening file bytes. The cipher is the one `@neutrino/e2e-crypto` uses on the main
 *   thread, unchanged — this moves where it runs, not what it writes.
 * - Spell-checking. Building the dictionary took ~250 ms at 4× CPU the moment an editor opened, and
 *   every check after that ran inside a keystroke. Here the dictionary is built once per tab, off
 *   the page, and words are checked in batches.
 *
 * Messages are `{ id, op, args }`; every reply is `{ id, ok, value | error }`.
 */

import { decryptFile, encryptFile, initSodium } from '@neutrino/e2e-crypto';
import type { EditorWorkerRequest } from './editorWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

type Spell = { correct(word: string): boolean; suggest(word: string): string[] };
let spell: Promise<Spell> | null = null;

function loadSpell(): Promise<Spell> {
  spell ??= (async () => {
    const [aff, dic] = await Promise.all([
      fetch('/dictionaries/en/index.aff').then((r) => {
        if (!r.ok) throw new Error('dictionary');
        return r.text();
      }),
      fetch('/dictionaries/en/index.dic').then((r) => {
        if (!r.ok) throw new Error('dictionary');
        return r.text();
      }),
    ]);
    const { default: NSpell } = await import('nspell');
    return NSpell(aff, dic) as Spell;
  })().catch((err) => {
    spell = null; // a failed fetch can be retried
    throw err;
  });
  return spell;
}

async function handle(req: EditorWorkerRequest): Promise<{ value: unknown; transfer?: Transferable[] }> {
  switch (req.op) {
    case 'encrypt': {
      await initSodium();
      const out = encryptFile(req.args.bytes, req.args.key);
      return { value: out, transfer: [out.buffer] };
    }
    case 'decrypt': {
      await initSodium();
      const out = decryptFile(req.args.bytes, req.args.key);
      return { value: out, transfer: [out.buffer] };
    }
    case 'spell.load':
      await loadSpell();
      return { value: true };
    case 'spell.check': {
      const s = await loadSpell();
      return { value: req.args.words.map((w) => s.correct(w)) };
    }
    case 'spell.suggest': {
      const s = await loadSpell();
      return { value: s.suggest(req.args.word) };
    }
  }
}

self.onmessage = (event: MessageEvent<EditorWorkerRequest>) => {
  const req = event.data;
  handle(req).then(
    ({ value, transfer }) => self.postMessage({ id: req.id, ok: true, value }, { transfer: transfer ?? [] }),
    (err: unknown) => self.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
};
