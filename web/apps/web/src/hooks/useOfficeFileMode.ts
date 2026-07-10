/**
 * Office file mode preference (issue #43 — in-place editing of MS Office
 * docs), persisted in localStorage.
 *
 * Controls whether a raw .docx/.xlsx/.pptx opened from Drive stays a real
 * Office file at rest, re-serialized on every save ("native-roundtrip", the
 * default), or gets silently promoted into a native Neutrino doc/sheet/slide
 * on first open ("convert-on-open"). See
 * agent_docs/plans/feature-office-doc-inplace-editing.md.
 *
 * Only read at editor-mount time — per the plan, no live-updating
 * subscription is needed for this key, so this is a plain getter rather than
 * a hook/context (unlike e.g. usePhotoSettings, which does need cross-tab
 * sync for a toggle surfaced live in the UI).
 */

export const OFFICE_FILE_MODE_KEY = 'neutrino:drive:officeFileMode';

export type OfficeFileMode = 'native-roundtrip' | 'convert-on-open';

const DEFAULT_OFFICE_FILE_MODE: OfficeFileMode = 'native-roundtrip';

/** Reads the current office-file-mode preference (safe on the server). */
export function getOfficeFileMode(): OfficeFileMode {
  if (typeof window === 'undefined') return DEFAULT_OFFICE_FILE_MODE;
  const stored = window.localStorage.getItem(OFFICE_FILE_MODE_KEY);
  if (stored === 'native-roundtrip' || stored === 'convert-on-open') return stored;
  return DEFAULT_OFFICE_FILE_MODE;
}

/**
 * True when the URL carries a one-shot promote request (`?promote=1`), set by
 * the Drive context menu's "Convert to Neutrino X" action. Editors check this
 * alongside `getOfficeFileMode() === 'convert-on-open'` when deciding whether
 * to auto-promote a freshly opened office file — this lets the manual action
 * force a promote for a single open regardless of the persisted preference.
 */
export function isOneShotPromoteRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('promote') === '1';
}
