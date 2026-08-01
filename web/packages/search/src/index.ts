export type { SearchableDocType, SearchableDocument, SearchResult } from './types';
export { normalizeText, tokenizeWithPositions } from './tokenizer';
export type { TermWithPositions } from './tokenizer';
export { openSearchDb, resetSearchDb, clearSearchIndex, deleteTokenEntries, getAllDocEntries } from './db';
export type { TokenEntry, DocEntry } from './db';
export { IndexEngine } from './engine';
