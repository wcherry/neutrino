/**
 * The app libraries — `/docs`, `/sheets`, `/slides`, `/drawing`, `/diagrams`
 * and `/notes` — as data.
 *
 * Every library is the same page (`FileLibrary`): Drive's own file listing,
 * cards, menu and actions, narrowed to one kind of file. What tells them apart
 * is only the filter sent to `GET /api/v1/drive/files` and the words around it,
 * so that is all this holds. A new library is a row here and a one-line page.
 */

import { FileText, GitBranch, NotebookPen, Paintbrush, Presentation, Table2, type LucideIcon } from 'lucide-react';
import { DIAGRAM_MIME_TYPE, DIAGRAM_SVG_MIME_TYPE } from '@neutrino/api-diagrams';
import type { FileListQuery } from '@neutrino/api-drive';
import type { NewItemKind } from '@/lib/newItems';

export type FileLibraryId = 'docs' | 'sheets' | 'slides' | 'drawings' | 'diagrams' | 'notes';

export interface FileLibraryConfig {
  /** Page heading. */
  title: string;
  /** Lowercase singular for the create button and empty state. */
  noun: string;
  /** The empty state's picture. */
  icon: LucideIcon;
  /**
   * What the listing asks the server for. A per-app `type` where one names the
   * set exactly; Diagrams alone needs a MIME list, because a diagram is stored
   * either as its own JSON or as an SVG (see `diagramFormatForMime`), and the
   * backend's `diagram` type — pinned by shipped native clients — is the first only.
   */
  filter: Pick<FileListQuery, 'type' | 'mimeType'>;
  /** What the create button makes. */
  newItem: NewItemKind;
}

export const FILE_LIBRARIES: Record<FileLibraryId, FileLibraryConfig> = {
  docs: { title: 'Documents', noun: 'document', icon: FileText, filter: { type: 'doc' }, newItem: 'doc' },
  sheets: { title: 'Spreadsheets', noun: 'spreadsheet', icon: Table2, filter: { type: 'sheet' }, newItem: 'sheet' },
  slides: { title: 'Presentations', noun: 'presentation', icon: Presentation, filter: { type: 'slide' }, newItem: 'slide' },
  drawings: { title: 'Drawings', noun: 'drawing', icon: Paintbrush, filter: { type: 'drawing' }, newItem: 'drawing' },
  diagrams: {
    title: 'Diagrams',
    noun: 'diagram',
    icon: GitBranch,
    filter: { mimeType: [DIAGRAM_MIME_TYPE, DIAGRAM_SVG_MIME_TYPE] },
    newItem: 'diagram',
  },
  notes: { title: 'Notes', noun: 'note', icon: NotebookPen, filter: { type: 'note' }, newItem: 'note' },
};
