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

import React, { useEffect } from 'react';
import { X, ExternalLink, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Text, Spinner, Button } from '@neutrino/ui';
import { useRouter } from 'next/navigation';

import {
  docsApi,
  sheetsApi,
  slidesApi,
  notesApi,
  driveReadContent,
} from '@/lib/api';

import {
  parseBlocks,
  renderInline,
} from '@/app/(apps)/notes/editor/blockEditorHelpers';
import type { Block } from '@/app/(apps)/notes/editor/blockEditorTypes';

import {
  slideBackgroundStyle,
} from '@/app/(apps)/slides/editor/slideEditorHelpers';

import {
  ShapeRenderer,
} from '@/app/(apps)/slides/editor/SlideCanvas';

import type {
  SlidePresentation,
  TextElement,
  ShapeElement,
} from '@/app/(apps)/slides/editor/slideEditorTypes';

import type { SheetFile, CellProps } from '@/app/(apps)/sheets/editor/types';
import { computeCell } from '@/app/(apps)/sheets/editor/formula';
import { numToAlpha } from '@/app/(apps)/sheets/editor/utils';

import styles from './DocumentPreviewModal.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocumentKind = 'doc' | 'sheet' | 'slide' | 'note';

export interface DocumentPreviewModalProps {
  id: string;
  kind: DocumentKind;
  onClose: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function editorRoute(kind: DocumentKind, id: string): string {
  const base = kind === 'doc' ? '/docs' : kind === 'sheet' ? '/sheets' : kind === 'slide' ? '/slides' : '/notes';
  return `${base}/editor?id=${id}`;
}

// ── Doc preview ───────────────────────────────────────────────────────────────

function DocPreview({ id }: { id: string }) {
  const { data: doc } = useQuery({
    queryKey: ['doc', id],
    queryFn: () => docsApi.getDoc(id),
    staleTime: 0,
    enabled: !!id,
  });

  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['doc-content-preview', id],
    queryFn: async () => {
      if (!doc?.contentUrl) return null;
      return driveReadContent(doc.contentUrl);
    },
    enabled: !!doc?.contentUrl,
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

  // The doc content is a Tiptap JSON document. Parse and extract an HTML-like
  // structure for read-only rendering without loading the full editor bundle.
  let html = '';
  try {
    const json = JSON.parse(content);
    html = tiptapJsonToHtml(json);
  } catch {
    html = `<p>${escapeHtml(content)}</p>`;
  }

  return (
    <div
      className={styles.docContent}
      // We produce the HTML ourselves from the Tiptap JSON; it is not user-
      // supplied HTML so dangerouslySetInnerHTML is safe here.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── Sheet preview ─────────────────────────────────────────────────────────────

const PREVIEW_MAX_ROWS = 50;
const PREVIEW_MAX_COLS = 26;

function SheetPreview({ id }: { id: string }) {
  const { data: sheet } = useQuery({
    queryKey: ['sheet', id],
    queryFn: () => sheetsApi.getSheet(id),
    staleTime: 0,
    enabled: !!id,
  });

  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['sheet-content-preview', id],
    queryFn: async () => {
      if (!sheet?.contentUrl) return null;
      return driveReadContent(sheet.contentUrl);
    },
    enabled: !!sheet?.contentUrl,
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

  let sheetData: SheetFile | null = null;
  try {
    sheetData = JSON.parse(content) as SheetFile;
  } catch {
    return (
      <div className={styles.centered}>
        <Text color="muted">Could not parse spreadsheet content.</Text>
      </div>
    );
  }

  const firstSheet = sheetData?.sheets?.[0];
  if (!firstSheet) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This spreadsheet is empty.</Text>
      </div>
    );
  }

  // Build a cell map and resolve computed values
  const cellMap = new Map<string, CellProps>(
    Object.values(firstSheet.cells ?? {}).map((c) => [
      c.id,
      { id: c.id, raw: c.raw, edit: false, cellStyle: c.cellStyle },
    ])
  );
  for (const [, cell] of cellMap) {
    const { value } = computeCell(cell.raw ?? '', cellMap);
    cell.value = value;
  }

  // Determine the bounds of used cells (capped at preview limits)
  let maxRow = 0;
  let maxCol = 0;
  for (const id of cellMap.keys()) {
    const match = id.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const col = alphaToColIndex(match[1]);
    const row = parseInt(match[2], 10);
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
  }
  maxRow = Math.min(maxRow, PREVIEW_MAX_ROWS);
  maxCol = Math.min(maxCol, PREVIEW_MAX_COLS);

  if (maxRow === 0 && maxCol === 0) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This spreadsheet is empty.</Text>
      </div>
    );
  }

  const cols = Array.from({ length: maxCol }, (_, i) => numToAlpha(i + 1));
  const rows = Array.from({ length: maxRow }, (_, i) => i + 1);

  return (
    <div className={styles.sheetWrapper}>
      <table className={styles.sheetTable} aria-label="Spreadsheet preview">
        <thead>
          <tr>
            <th className={styles.sheetRowHeader} aria-label="Row numbers" />
            {cols.map((col) => (
              <th key={col} className={styles.sheetColHeader}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((rowNum) => (
            <tr key={rowNum}>
              <th className={styles.sheetRowHeader} scope="row">{rowNum}</th>
              {cols.map((col) => {
                const cellId = `${col}${rowNum}`;
                const cell = cellMap.get(cellId);
                const displayValue = cell?.value ?? cell?.raw ?? '';
                // Cell background must be applied inline and must not be overridden
                // by any dark-theme class on the modal wrapper.
                const cellBg = cell?.cellStyle?.backgroundColor;
                const cellColor = cell?.cellStyle?.color;
                const cellStyle: React.CSSProperties = {};
                if (cellBg) cellStyle.backgroundColor = cellBg;
                if (cellColor) cellStyle.color = cellColor;
                if (cell?.cellStyle?.fontWeight === 'bold') cellStyle.fontWeight = 700;
                if (cell?.cellStyle?.fontStyle === 'italic') cellStyle.fontStyle = 'italic';
                if (cell?.cellStyle?.textAlign) cellStyle.textAlign = cell.cellStyle.textAlign;
                return (
                  <td key={cellId} className={styles.sheetCell} style={cellStyle} title={displayValue}>
                    {displayValue}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Slide preview ─────────────────────────────────────────────────────────────

function SlidePreview({ id }: { id: string }) {
  const { data: slide } = useQuery({
    queryKey: ['slide', id],
    queryFn: () => slidesApi.getSlide(id),
    staleTime: 0,
    enabled: !!id,
  });

  const { data: content, isLoading, isError } = useQuery({
    queryKey: ['slide-content-preview', id],
    queryFn: async () => {
      if (!slide?.contentUrl) return null;
      return driveReadContent(slide.contentUrl);
    },
    enabled: !!slide?.contentUrl,
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

  const slides = presentation?.slides ?? [];
  if (slides.length === 0) {
    return (
      <div className={styles.centered}>
        <Text color="muted">This presentation has no slides.</Text>
      </div>
    );
  }

  return (
    <div className={styles.slidesTrack}>
      {slides.map((s, i) => (
        <div key={s.id} className={styles.slidePreviewItem}>
          <span className={styles.slideNumber}>{i + 1}</span>
          <div className={styles.slideThumbnailWrapper} style={slideBackgroundStyle(s.background)}>
            {s.elements.map((el) => {
              if (el.type === 'text') {
                const textEl = el as TextElement;
                return (
                  <div
                    key={el.id}
                    style={{
                      position: 'absolute',
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      width: `${el.w}%`,
                      height: `${el.h}%`,
                      fontSize: `${textEl.style.fontSize * 0.075}px`,
                      fontWeight: textEl.style.bold ? 700 : 400,
                      fontStyle: textEl.style.italic ? 'italic' : 'normal',
                      color: textEl.style.color,
                      textAlign: textEl.style.align,
                      overflow: 'hidden',
                      lineHeight: 1.2,
                      fontFamily: textEl.style.fontFamily || undefined,
                    }}
                  >
                    {textEl.content}
                  </div>
                );
              }
              if (el.type === 'shape') {
                const shapeEl = el as ShapeElement;
                return (
                  <div
                    key={el.id}
                    style={{
                      position: 'absolute',
                      left: `${el.x}%`,
                      top: `${el.y}%`,
                      width: `${el.w}%`,
                      height: `${el.h}%`,
                    }}
                  >
                    <ShapeRenderer el={shapeEl} />
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Note preview ──────────────────────────────────────────────────────────────

function NotePreview({ id }: { id: string }) {
  const { data: note, isLoading, isError } = useQuery({
    queryKey: ['note', id],
    queryFn: () => notesApi.getNote(id),
    staleTime: 0,
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className={styles.centered}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !note) {
    return (
      <div className={styles.centered}>
        <AlertCircle size={36} style={{ color: 'var(--color-text-muted)' }} />
        <Text color="muted">Failed to load note preview.</Text>
      </div>
    );
  }

  const blocks: Block[] = parseBlocks(note.content);

  return (
    <div className={styles.noteContent}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'bullet':
            return (
              <div key={block.id ?? idx} className={styles.noteBlockBullet}>
                <span className={styles.noteBulletDot} aria-hidden />
                <span>{renderInline(block.content, [], () => {})}</span>
              </div>
            );
          case 'numbered':
            return (
              <div key={block.id ?? idx} style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <span style={{ flexShrink: 0, color: 'var(--color-text-muted)' }}>{idx + 1}.</span>
                <span>{renderInline(block.content, [], () => {})}</span>
              </div>
            );
          case 'code':
            return (
              <pre key={block.id ?? idx} className={styles.noteBlockCode}>{block.content}</pre>
            );
          case 'blockquote':
            return (
              <blockquote key={block.id ?? idx} className={styles.noteBlockQuote}>
                {renderInline(block.content, [], () => {})}
              </blockquote>
            );
          case 'task':
            return (
              <div key={block.id ?? idx} className={styles.noteTaskRow}>
                <span
                  className={[styles.noteTaskCheck, block.checked ? styles.noteTaskChecked : ''].filter(Boolean).join(' ')}
                  aria-label={block.checked ? 'Completed task' : 'Incomplete task'}
                />
                <span className={block.checked ? styles.noteTaskTextDone : styles.noteTaskText}>
                  {renderInline(block.content, [], () => {})}
                </span>
              </div>
            );
          default:
            // paragraph (and any unrecognised type)
            return (
              <div key={block.id ?? idx} className={styles.noteBlock}>
                {renderInline(block.content, [], () => {})}
              </div>
            );
        }
      })}
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

export function DocumentPreviewModal({ id, kind, onClose }: DocumentPreviewModalProps) {
  const router = useRouter();

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleBackdrop(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleOpen() {
    router.push(editorRoute(kind, id));
    onClose();
  }

  const kindLabel = kind === 'doc' ? 'Document' : kind === 'sheet' ? 'Spreadsheet' : kind === 'slide' ? 'Presentation' : 'Note';

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
          {kind === 'doc'   && <DocPreview   id={id} />}
          {kind === 'sheet' && <SheetPreview id={id} />}
          {kind === 'slide' && <SlidePreview id={id} />}
          {kind === 'note'  && <NotePreview  id={id} />}
        </div>
      </div>
    </div>
  );
}

// ── Utility: Tiptap JSON → HTML ───────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tiptapMarksToHtml(text: string, marks: any[] | undefined): string {
  if (!marks || marks.length === 0) return escapeHtml(text);
  let result = escapeHtml(text);
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold':
        result = `<strong>${result}</strong>`;
        break;
      case 'italic':
        result = `<em>${result}</em>`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'strike':
        result = `<s>${result}</s>`;
        break;
      case 'code':
        result = `<code>${result}</code>`;
        break;
      case 'link':
        result = `<a href="${escapeHtml(mark.attrs?.href ?? '#')}" target="_blank" rel="noopener noreferrer">${result}</a>`;
        break;
      case 'highlight':
        result = `<mark>${result}</mark>`;
        break;
      case 'textStyle': {
        const parts: string[] = [];
        if (mark.attrs?.color) parts.push(`color:${mark.attrs.color}`);
        if (mark.attrs?.fontFamily) parts.push(`font-family:${mark.attrs.fontFamily}`);
        if (parts.length > 0) result = `<span style="${parts.join(';')}">${result}</span>`;
        break;
      }
    }
  }
  return result;
}

function tiptapNodeToHtml(node: any): string {
  if (!node) return '';

  switch (node.type) {
    case 'doc':
      return (node.content ?? []).map(tiptapNodeToHtml).join('');

    case 'paragraph': {
      const inner = (node.content ?? []).map(tiptapNodeToHtml).join('');
      const align = node.attrs?.textAlign;
      const style = align ? ` style="text-align:${align}"` : '';
      return `<p${style}>${inner || '&#8203;'}</p>`;
    }

    case 'text':
      return tiptapMarksToHtml(node.text ?? '', node.marks);

    case 'hardBreak':
      return '<br>';

    case 'heading': {
      const level = node.attrs?.level ?? 2;
      const inner = (node.content ?? []).map(tiptapNodeToHtml).join('');
      return `<h${level}>${inner}</h${level}>`;
    }

    case 'bulletList':
      return `<ul>${(node.content ?? []).map(tiptapNodeToHtml).join('')}</ul>`;

    case 'orderedList':
      return `<ol>${(node.content ?? []).map(tiptapNodeToHtml).join('')}</ol>`;

    case 'listItem':
      return `<li>${(node.content ?? []).map(tiptapNodeToHtml).join('')}</li>`;

    case 'codeBlock': {
      const inner = escapeHtml((node.content ?? []).map((n: any) => n.text ?? '').join(''));
      return `<pre><code>${inner}</code></pre>`;
    }

    case 'blockquote':
      return `<blockquote>${(node.content ?? []).map(tiptapNodeToHtml).join('')}</blockquote>`;

    case 'horizontalRule':
      return '<hr>';

    case 'image':
      return `<img src="${escapeHtml(node.attrs?.src ?? '')}" alt="${escapeHtml(node.attrs?.alt ?? '')}" />`;

    case 'table': {
      const rows = (node.content ?? []).map(tiptapNodeToHtml).join('');
      return `<table>${rows}</table>`;
    }

    case 'tableRow':
      return `<tr>${(node.content ?? []).map(tiptapNodeToHtml).join('')}</tr>`;

    case 'tableCell': {
      const inner = (node.content ?? []).map(tiptapNodeToHtml).join('');
      return `<td>${inner}</td>`;
    }

    case 'tableHeader': {
      const inner = (node.content ?? []).map(tiptapNodeToHtml).join('');
      return `<th>${inner}</th>`;
    }

    default:
      // Unknown node: recurse into children if any
      return (node.content ?? []).map(tiptapNodeToHtml).join('');
  }
}

function tiptapJsonToHtml(json: any): string {
  return tiptapNodeToHtml(json);
}

// ── Utility: column alpha to 0-based index ────────────────────────────────────

function alphaToColIndex(alpha: string): number {
  let result = 0;
  for (let i = 0; i < alpha.length; i++) {
    result = result * 26 + (alpha.charCodeAt(i) - 64);
  }
  return result;
}
