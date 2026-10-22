import dynamic from 'next/dynamic';

/**
 * Loaded on first open. The preview renders each kind of document with that editor's own
 * renderer — Sheets, Slides, Notes, Drawing, Diagrams — so a static import put a slice of every
 * editor on Drive's first load (≈ 200 KB parsed) for a dialog most visits never open.
 */
export const DocumentPreviewModal = dynamic(
  () => import('./DocumentPreviewModal').then((m) => m.DocumentPreviewModal),
  { ssr: false },
);
export type { DocumentPreviewModalProps, DocumentKind } from './DocumentPreviewModal';
