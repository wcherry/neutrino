/**
 * Change notifications for the local search index.
 *
 * The index is one IndexedDB database shared by every app in the suite and by
 * every tab they are open in: Docs re-indexes on save, the periodic sync
 * re-indexes everything the server has touched, and a snapshot pull replaces
 * the lot. Nothing told the surfaces that *read* the index — the topbar
 * drop-down, the Drive search view, `/search` — that any of that had happened,
 * so results stayed as stale as whenever the query last ran.
 *
 * Every write path emits here, and readers subscribe to re-run their query.
 * This is the client-side half of "a … event can be used to notify all other
 * clients that the user's search index has changed" in `agent_docs/search.md`;
 * the cross-*device* half is the encrypted snapshot exchange.
 *
 * ## Scope
 *
 * Delivery is to subscribers in this tab *and*, over a `BroadcastChannel`, to
 * every other tab on the origin. Cross-tab matters because the index is shared
 * storage: a save in the Docs tab changes what the Drive tab's search box would
 * return, with nothing in that tab having run any code.
 *
 * Note what a listener does *not* have to do: the entries are already in
 * IndexedDB by the time the event fires, so "reload the index" means re-reading
 * it — running the query again — not fetching anything.
 *
 * ## Coalescing
 *
 * Emits are batched over `COALESCE_MS` and merged into one update. A rebuild
 * indexes documents one at a time and would otherwise fire a listener per
 * document, and each listener is expected to re-query.
 */

/** What changed in the index, as one merged batch. */
export interface SearchIndexUpdate {
  /**
   * Documents whose entries changed. Empty when `wholesale` — a listener that
   * cares about specific ids should treat that as "all of them".
   */
  documentIds: string[];
  /**
   * The index was dropped or replaced outright: a rebuild, or a snapshot
   * imported from another device. Anything read from it before is void.
   */
  wholesale: boolean;
  /** False when the update came from another tab. */
  local: boolean;
  /** When the batch was flushed, epoch millis. */
  at: number;
}

export type SearchIndexListener = (update: SearchIndexUpdate) => void;

const CHANNEL_NAME = 'neutrino:search-index';

/**
 * How long emits are gathered before listeners hear about them. Long enough
 * that a rebuild's per-document writes collapse into a handful of updates,
 * short enough that a save feels immediate in another tab.
 */
const COALESCE_MS = 250;

const listeners = new Set<SearchIndexListener>();

let channel: BroadcastChannel | null = null;
/** Set once we know there is no `BroadcastChannel` here, so we stop looking. */
let channelUnavailable = false;

let pending: { documentIds: Set<string>; wholesale: boolean } | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The shared channel, opened on first use.
 *
 * Lazily, and never at module scope: this module is imported by client
 * components that Next.js also renders on the server, where the constructor
 * does not exist. Older browsers and the odd test environment are the same
 * case — they lose cross-tab delivery and keep everything else.
 */
function getChannel(): BroadcastChannel | null {
  if (channel || channelUnavailable) return channel;
  if (typeof BroadcastChannel === 'undefined') {
    channelUnavailable = true;
    return null;
  }
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as Omit<SearchIndexUpdate, 'local'> | null;
    if (!data) return;
    // Not re-broadcast: the sending tab already reached everyone.
    deliver({
      documentIds: data.documentIds ?? [],
      wholesale: Boolean(data.wholesale),
      local: false,
      at: data.at ?? Date.now(),
    });
  };
  return channel;
}

function deliver(update: SearchIndexUpdate): void {
  for (const listener of [...listeners]) {
    try {
      listener(update);
    } catch {
      // One bad subscriber must not cost the others their notification.
    }
  }
}

function flush(): void {
  flushTimer = null;
  const batch = pending;
  pending = null;
  if (!batch) return;

  const update: SearchIndexUpdate = {
    // A wholesale change makes the id list meaningless — every entry is new.
    documentIds: batch.wholesale ? [] : [...batch.documentIds],
    wholesale: batch.wholesale,
    local: true,
    at: Date.now(),
  };

  deliver(update);

  try {
    getChannel()?.postMessage({
      documentIds: update.documentIds,
      wholesale: update.wholesale,
      at: update.at,
    });
  } catch {
    // A closed or unusable channel costs other tabs this notification; their
    // next sync or query picks the change up regardless.
  }
}

/**
 * Announce that the index changed.
 *
 * Called by the write paths themselves (`IndexEngine`, `clearSearchIndex`,
 * `importSnapshot`) rather than by their callers, so a new way to write to the
 * index cannot forget to notify.
 *
 * Emit *after* the write has landed: a listener re-reads the index as soon as
 * it hears, and the point is for it to see the new state.
 */
export function emitSearchIndexUpdate(change: {
  documentIds?: string[];
  /** The whole index was dropped or replaced. */
  wholesale?: boolean;
}): void {
  pending ??= { documentIds: new Set<string>(), wholesale: false };
  if (change.wholesale) pending.wholesale = true;
  for (const id of change.documentIds ?? []) pending.documentIds.add(id);

  if (flushTimer === null) flushTimer = setTimeout(flush, COALESCE_MS);
}

/**
 * Listen for index changes, from this tab or any other. Returns the
 * unsubscribe function.
 */
export function subscribeToSearchIndexUpdates(listener: SearchIndexListener): () => void {
  listeners.add(listener);
  // Opened here as well as on emit, so a tab that only ever reads the index
  // still hears about writes made in the tab that owns the editor.
  getChannel();
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam — drops subscribers, any pending batch, and the channel. */
export function resetSearchIndexEvents(): void {
  listeners.clear();
  pending = null;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  channel?.close();
  channel = null;
  channelUnavailable = false;
}
