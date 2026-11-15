'use client';

/**
 * DocumentPreviewModal
 *
 * A read-only preview modal for Docs, Sheets, Slides, and Notes documents.
 * Fetches the document content on mount and renders a lightweight, non-editable
 * view. A prominent "Open in editor" button lets the user navigate to the full
 * editor without closing the modal manually.
 *
 * Feature flag: feature.documents.preview
 */

import React from 'react';
import { X, ExternalLink, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Text, Spinner, Button } from '@neutrino/ui';
import { useRouter } from 'next/navigation';
import { decryptFile, fromBase64url, initSodium } from '@neutrino/e2e-crypto';

import {
  diagramsApi,
  drawingApi,
  storageApi,
  driveReadContent,
} from '@/lib/api';

import { useEncryptedDocumentContent } from '@/hooks/useEncryptedDocumentContent';
import { readStoredDocumentBody } from '@/lib/documentContent';
import {
  DiagramView,
  DocView,
  DrawingView,
  NoteView,
  SheetView,
  SlideView,
} from './previewViews';
import type { SlidePresentation } from '@/app/(apps)/slides/editor/slideEditorTypes';

import { readStoredBody } from '@/lib/storedBody';

import { useDismiss } from '@neutrino/commands';
import styles from './DocumentPreviewModal.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocumentKind = 'doc' | 'sheet' | 'slide' | 'note' | 'diagram' | 'drawing';

export interface DocumentPreviewModalProps {
  id: string;
  kind: DocumentKind;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function editorRoute(kind: DocumentKind, id: string): string {
  const base =
    kind === 'doc' ? '/docs' :
    kind === 'sheet' ? '/sheets' :
    kind === 'slide' ? '/slides' :
    kind === 'diagram' ? '/diagrams' :
    kind === 'drawing' ? '/drawing' :
    '/notes';
  return `${base}/editor?id=${id}`;
}

// ── Doc preview ───────────────────────────────────────────────────────────────

function DocPreview({ id }: { id: string }) {
  const { dekRef, dekResolved } = useEncryptedDocumentContent({
    id,
    filename: 'doc.json',
  });

  // Deliberately not gated on the app's own metadata call. That answers only
  // for the bespoke JSON format, so gating on it left every `.docx`/`.xlsx`/
  // `.pptx` — which is every document created since issue #127 — on a spinner
  // that never resolved. `readStoredDocumentBody` reads either format.
  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['doc-content-preview', id, dekResolved],
    queryFn: () => readStoredDocumentBody(id, 'docs', dekRef.current),
    enabled: !!id && dekResolved,
    staleTime: 0,
  });

  if (isError) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load document preview.</Text>
      </div>
    );
  }

  if (isLoading || !content) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  return <DocView content={content} />;
}

// ── Sheet preview ─────────────────────────────────────────────────────────────


function SheetPreview({ id }: { id: string }) {
  const { dekRef, dekResolved } = useEncryptedDocumentContent({
    id,
    filename: 'sheet.json',
  });

  // Deliberately not gated on the app's own metadata call. That answers only
  // for the bespoke JSON format, so gating on it left every `.docx`/`.xlsx`/
  // `.pptx` — which is every document created since issue #127 — on a spinner
  // that never resolved. `readStoredDocumentBody` reads either format.
  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['sheet-content-preview', id, dekResolved],
    queryFn: () => readStoredDocumentBody(id, 'sheets', dekRef.current),
    enabled: !!id && dekResolved,
    staleTime: 0,
  });

  if (isError) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load spreadsheet preview.</Text>
      </div>
    );
  }

  if (isLoading || !content) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  return <SheetView content={content} />;
}

// ── Slide preview ─────────────────────────────────────────────────────────────

function SlidePreview({ id }: { id: string }) {
  const { dekRef, dekResolved } = useEncryptedDocumentContent({
    id,
    filename: 'slide.json',
  });

  // Deliberately not gated on the app's own metadata call. That answers only
  // for the bespoke JSON format, so gating on it left every `.docx`/`.xlsx`/
  // `.pptx` — which is every document created since issue #127 — on a spinner
  // that never resolved. `readStoredDocumentBody` reads either format.
  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['slide-content-preview', id, dekResolved],
    queryFn: () => readStoredDocumentBody(id, 'slides', dekRef.current),
    enabled: !!id && dekResolved,
    staleTime: 0,
  });

  if (isError) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load presentation preview.</Text>
      </div>
    );
  }

  if (isLoading || !content) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  let presentation: SlidePresentation | null = null;
  try {
    presentation = JSON.parse(content) as SlidePresentation;
  } catch {
    return (
      <div className={styles.centered}>
        <Text color="muted">Could not parse presentation content.</Text>
      </div>
    );
  }

  return <SlideView presentation={presentation} />;
}

// ── Note preview ──────────────────────────────────────────────────────────────

function NotePreview({ id }: { id: string }) {
  const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({
    id,
    filename: 'note.md',
  });

  const { data: note, isLoading: metaLoading, isError: metaIsError } = useQuery({
    queryKey: ['note', id],
    queryFn: () => storageApi.getFileInfo(id),
    staleTime: 0,
    enabled: !!id,
  });

  const { data: content, isLoading: contentLoading, isError: contentIsError } = useQuery({
    queryKey: ['note-content-preview', id, dekResolved, !!note],
    queryFn: async () => {
      if (!note) return null;
      if (dekRef.current && !isNewEncryption) {
        try {
          await initSodium();
          const blob = await storageApi.downloadFile(id);
          const stored = new Uint8Array(await blob.arrayBuffer());
          let plainBytes: Uint8Array;
          try {
            plainBytes = decryptFile(
              fromBase64url(new TextDecoder().decode(stored)),
              dekRef.current,
            );
          } catch {
            plainBytes = decryptFile(stored, dekRef.current);
          }
          return new TextDecoder().decode(plainBytes);
        } catch {
          // Corrupt ciphertext or a stale/expired key ref — fall back to the
          // raw content rather than crashing the preview.
        }
      }
      return driveReadContent(`/api/v1/drive/files/${id}`);
    },
    enabled: !!note && dekResolved,
    staleTime: 0,
  });

  const isLoading = metaLoading || (!!note && contentLoading);

  if (isLoading) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (metaIsError || contentIsError || !note || content == null) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load note preview.</Text>
      </div>
    );
  }

  return <NoteView content={content} />;
}

// ── Diagram preview ───────────────────────────────────────────────────────────

function DiagramPreview({ id }: { id: string }) {
  const { dekRef, dekResolved, isNewEncryption } = useEncryptedDocumentContent({
    id,
    filename: 'diagram.json',
  });

  const { data: diagram } = useQuery({
    queryKey: ['diagram', id],
    queryFn: () => diagramsApi.getDiagram(id),
    staleTime: 0,
    enabled: !!id,
  });

  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['diagram-content-preview', id, dekResolved, diagram?.contentUrl ?? ''],
    queryFn: async () => {
      if (!diagram?.contentUrl) return null;
      if (dekRef.current) {
        const blob = await storageApi.downloadFile(id);
        const cipherBytes = new Uint8Array(await blob.arrayBuffer());
        try {
          const plainBytes = decryptFile(cipherBytes, dekRef.current);
          return new TextDecoder().decode(plainBytes);
        } catch {
          if (isNewEncryption) return null;
          return driveReadContent(diagram.contentUrl);
        }
      }
      return driveReadContent(diagram.contentUrl);
    },
    enabled: !!diagram?.contentUrl && dekResolved,
    staleTime: 0,
  });

  if (isError) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load diagram preview.</Text>
      </div>
    );
  }

  if (isLoading || !content) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  return <DiagramView content={content} />;
}

// ── Drawing preview ───────────────────────────────────────────────────────────

function DrawingPreview({ id }: { id: string }) {
  // Drawings are E2EE like every other document (issue #95). This preview used
  // to read the body as plaintext with a comment saying drawings were the
  // exception, which stopped being true when the editor started encrypting
  // them — so every encrypted drawing previewed as "could not parse".
  const { dekRef, dekResolved } = useEncryptedDocumentContent({ id, filename: 'drawing.json' });

  const { data: drawing } = useQuery({
    queryKey: ['drawing', id],
    queryFn: () => drawingApi.getDrawing(id),
    staleTime: 0,
    enabled: !!id,
  });

  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['drawing-content-preview', id, dekResolved],
    queryFn: async () => {
      const blob = await storageApi.downloadFile(id);
      const stored = new Uint8Array(await blob.arrayBuffer());
      // `readStoredBody` decides from the bytes whether the body is ciphertext,
      // so a drawing seeded before its first save still previews.
      return readStoredBody(stored, dekRef.current ?? new Uint8Array(32)).text;
    },
    enabled: !!drawing && dekResolved,
    staleTime: 0,
  });

  if (isError) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load drawing preview.</Text>
      </div>
    );
  }

  if (isLoading || content == null) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  return <DrawingView content={content} />;
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export function DocumentPreviewModal({ id, kind, onClose }: DocumentPreviewModalProps) {
  const router = useRouter();

  // Close on Escape
  useDismiss(() => onClose());

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleOpen() {
    router.push(editorRoute(kind, id));
    onClose();
  }

  const kindLabel =
    kind === 'doc' ? 'Document' :
    kind === 'sheet' ? 'Spreadsheet' :
    kind === 'slide' ? 'Presentation' :
    kind === 'diagram' ? 'Diagram' :
    kind === 'drawing' ? 'Drawing' :
    'Note';

  return (
    <div
      className={styles.backdrop}
      onClick={handleBackdrop}
      role="dialog"
      aria-modal
      aria-label={`Preview ${kindLabel}`}
    >
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles['header-left']}>
            <Text size="sm" weight="semibold" color="muted">{kindLabel} preview</Text>
          </div>
          <div className={styles['header-actions']}>
            <Button
              variant="primary"
              size="sm"
              icon={<ExternalLink size={14} />}
              onClick={handleOpen}
            >
              Open in editor
            </Button>
            <button
              type="button"
              className={styles['icon-btn']}
              onClick={onClose}
              aria-label="Close preview"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {kind === 'doc'     && <DocPreview     id={id} />}
          {kind === 'sheet'   && <SheetPreview   id={id} />}
          {kind === 'slide'   && <SlidePreview   id={id} />}
          {kind === 'note'    && <NotePreview    id={id} />}
          {kind === 'diagram' && <DiagramPreview id={id} />}
          {kind === 'drawing' && <DrawingPreview id={id} />}
        </div>
      </div>
    </div>
  );
}
