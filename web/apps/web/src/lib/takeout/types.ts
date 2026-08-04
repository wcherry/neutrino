/**
 * What every Takeout import run reports, whatever product it read.
 *
 * The runners (`importKeep.ts`, `importDocs.ts`) differ in what they convert
 * and what options they take, but the import page renders their progress and
 * their results with the same components, so the reporting side is shared.
 */

export type ImportStatus = 'imported' | 'skipped' | 'failed';

export interface ImportItem {
  /** The file inside the export, e.g. `Some note.json`. */
  file: string;
  title: string;
  status: ImportStatus;
  /** Why it was skipped or how it failed. Absent for an import. */
  reason?: string;
}

export interface ImportProgress {
  /** Items processed so far, including skipped and failed ones. */
  done: number;
  total: number;
  /** The item being worked on. */
  current: string;
}

export interface ImportSummary {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  items: ImportItem[];
  /** Set when the import went into a folder. */
  folderId: string | null;
  /** True when the user stopped the run before it finished. */
  cancelled: boolean;
  /**
   * True when this device holds no E2EE key pair, so the content was written
   * as plaintext. The caller warns about it.
   */
  unencrypted: boolean;
}
