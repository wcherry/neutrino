export type SearchableDocType =
  | 'document'
  | 'spreadsheet'
  | 'note'
  | 'slide'
  | 'diagram'
  | 'drawing'
  | 'event'
  | 'reminder'
  /** A Drive file with no in-app text — indexed by name only. */
  | 'file';

export interface SearchableDocument {
  id: string;
  type: SearchableDocType;
  title: string;
  content: string;
  updatedAt: number;
  /** Drive mimetype, for `file` entries — drives the result icon and link. */
  mimeType?: string;
}

export interface SearchResult {
  docId: string;
  type: SearchableDocType;
  title: string;
  score: number;
  snippets: string[];
  /** Epoch millis of the indexed revision — 0 when the entry predates title/date storage. */
  updatedAt: number;
  mimeType?: string;
}
