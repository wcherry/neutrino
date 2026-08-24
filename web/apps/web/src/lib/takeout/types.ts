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
   * True when this device holds no E2EE key pair, so the run **did not happen**.
   *
   * It used to mean the opposite — that the import went ahead and wrote every
   * item as plaintext, on the reasoning that a half-imported library is worse
   * than a plaintext one. That reasoning had the cost backwards: a plaintext
   * import is thousands of files with no key ref, none of which anything ever
   * comes back to encrypt (issue #95), whereas an import that declines can be
   * run again in full the moment the vault is unlocked. So the runners stop
   * before the first write, and the caller says so.
   */
  unencrypted: boolean;
}
