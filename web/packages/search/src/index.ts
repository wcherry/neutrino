export type { SearchableDocType, SearchableDocument, SearchResult } from './types';
export { normalizeText, tokenizeWithPositions } from './tokenizer';
export type { TermWithPositions } from './tokenizer';
export { openSearchDb, resetSearchDb, clearSearchIndex, deleteTokenEntries, getAllDocEntries, countDocEntries } from './db';
export type { TokenEntry, DocEntry } from './db';
export { IndexEngine } from './engine';
export {
  emitSearchIndexUpdate,
  subscribeToSearchIndexUpdates,
  resetSearchIndexEvents,
} from './events';
export type { SearchIndexUpdate, SearchIndexListener } from './events';
export {
  exportSnapshot,
  importSnapshot,
  serializeSnapshot,
  deserializeSnapshot,
  SNAPSHOT_FORMAT,
} from './snapshot';
export type { IndexSnapshot, SnapshotToken } from './snapshot';
