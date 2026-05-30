export type SearchableDocType =
  | 'document'
  | 'spreadsheet'
  | 'note'
  | 'slide'
  | 'event'
  | 'reminder';

export interface SearchableDocument {
  id: string;
  type: SearchableDocType;
  title: string;
  content: string;
  updatedAt: number;
}

export interface SearchResult {
  docId: string;
  type: SearchableDocType;
  title: string;
  score: number;
  snippets: string[];
}
