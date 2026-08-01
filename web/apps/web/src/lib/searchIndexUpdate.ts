/**
 * Keeping the search index current as the user types.
 *
 * `syncSearchIndex` (see `searchIndexer.ts`) only runs on app start and tab
 * focus, throttled to once every five minutes, so on its own it leaves an edit
 * unsearchable for minutes after it was saved. Editors call `indexOnSave` from
 * their autosave path to close that window: they already hold the plaintext
 * they just wrote, so re-indexing costs a tokenize pass and no network at all.
 *
 * This is the "every save should create a background process to update the
 * search index" half of `agent_docs/search.md`.
 */

import { IndexEngine, type SearchableDocType } from '@neutrino/search';
import { loadKeyPair } from '@neutrino/e2e-crypto';

/**
 * How long to wait for the typing to settle before re-indexing. Autosave is
 * itself debounced, but a long editing session still fires it repeatedly and
 * every run re-tokenizes the whole document.
 */
const COALESCE_MS = 2_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let engine: IndexEngine | null = null;

/** Serialises runs so two saves of the same document can't interleave in IDB. */
let queue: Promise<unknown> = Promise.resolve();

export interface SaveIndexInput {
  id: string;
  type: SearchableDocType;
  title: string;
  /** The plain text of what was just saved — already extracted, not the raw JSON. */
  content: string;
  /**
   * The saved revision's server timestamp, when the save response carried one.
   * `syncSearchIndex` skips entries at or ahead of the server's `updatedAt`, so
   * passing the real value keeps the next sync from re-fetching this document.
   * Defaults to now, which is close enough to have the same effect.
   */
  updatedAt?: number;
}

/**
 * Re-index a document the user just saved. Fire-and-forget: indexing is
 * best-effort background work and must never surface an error into a save that
 * actually succeeded.
 *
 * Calls for the same `id` coalesce, so holding down a key costs one re-index
 * rather than one per autosave.
 */
export function indexOnSave(userId: string | undefined, doc: SaveIndexInput): void {
  // The index holds decrypted text, so it only makes sense on a device that
  // has the user's E2EE keys — the same gate the sync and query paths use.
  if (!userId || !loadKeyPair(userId)) return;

  const existing = timers.get(doc.id);
  if (existing) clearTimeout(existing);

  timers.set(
    doc.id,
    setTimeout(() => {
      timers.delete(doc.id);
      engine ??= new IndexEngine();
      queue = queue
        .then(() => engine!.updateDocument({ ...doc, updatedAt: doc.updatedAt ?? Date.now() }))
        .catch(() => {
          // Swallowed: the next periodic sync re-indexes anything missed here.
        });
    }, COALESCE_MS),
  );
}

/** Test seam — drops pending timers and the cached engine. */
export function resetIndexOnSave(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  engine = null;
  queue = Promise.resolve();
}
