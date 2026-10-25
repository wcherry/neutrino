/**
 * Where each kind of file goes in a local import.
 *
 * The options are deliberately few, and each one is something the app can
 * honour:
 *
 * - **Photos and Drive, together.** Every Photos library item is a Drive image
 *   and every Drive image is in the library, so "Photos only" and "Drive only"
 *   cannot be kept apart and are not offered.
 * - **Office files go to Drive byte for byte.** A document *is* a `.docx`, a
 *   spreadsheet an `.xlsx`, a presentation a `.pptx`; the editors open them as
 *   they are, so nothing is converted.
 * - **Markdown is a note.** A `text/markdown` Drive file is what a note is, so
 *   "Drive" for Markdown is offered as plain text files (`text/plain`) — the only
 *   way a `.md` can sit in Drive without being a note.
 */

import type { ImportKind } from './classify';
import type { LocalImportFile } from './scan';

export type Destination = 'photos-drive' | 'drive' | 'notes' | 'drive-plain' | 'skip';
export type DestinationChoice = Record<ImportKind, Destination>;

export const DEFAULT_DESTINATIONS: DestinationChoice = {
  media: 'photos-drive',
  office: 'drive',
  markdown: 'notes',
  other: 'drive',
};

const SKIP = { value: 'skip', label: "Don't import" } as const;

export const DESTINATION_OPTIONS: Record<ImportKind, { value: Destination; label: string }[]> = {
  media: [{ value: 'photos-drive', label: 'Photos and Drive' }, SKIP],
  office: [{ value: 'drive', label: 'Drive — opens in Docs, Sheets, Slides' }, SKIP],
  markdown: [
    { value: 'notes', label: 'Notes' },
    { value: 'drive-plain', label: 'Drive, as plain text files' },
    SKIP,
  ],
  other: [{ value: 'drive', label: 'Drive' }, SKIP],
};

export const KIND_LABELS: Record<ImportKind, string> = {
  media: 'Photos & videos',
  office: 'Word, Excel, PowerPoint',
  markdown: 'Markdown notes',
  other: 'Everything else',
};

/** Which import step a file runs in — also the product label on the result screen. */
export type ImportProduct = 'Photos' | 'Drive' | 'Notes';

export interface PlannedFile {
  source: LocalImportFile;
  product: ImportProduct;
  /** The mime type it uploads with. */
  mimeType: string;
}

function plan(file: LocalImportFile, destination: Destination): PlannedFile | null {
  switch (destination) {
    case 'skip':
      return null;
    case 'photos-drive':
      return { source: file, product: 'Photos', mimeType: file.mimeType };
    case 'notes':
      return { source: file, product: 'Notes', mimeType: 'text/markdown' };
    case 'drive-plain':
      return { source: file, product: 'Drive', mimeType: 'text/plain' };
    case 'drive':
      return { source: file, product: 'Drive', mimeType: file.mimeType };
  }
}

/** What each file becomes under `choice`; kinds set to skip are left out. */
export function routeFiles(files: LocalImportFile[], choice: DestinationChoice): PlannedFile[] {
  const planned: PlannedFile[] = [];
  for (const file of files) {
    const p = plan(file, choice[file.kind]);
    if (p) planned.push(p);
  }
  return planned;
}

export function plannedBytes(planned: PlannedFile[]): number {
  return planned.reduce((sum, p) => sum + p.source.file.size, 0);
}
