'use client';

import React, { useRef, useState } from 'react';
import type { DiagramDocument, DiagramShape, DiagramConnector } from '../../types';
import { importJSON, importDrawioXML, importMermaid } from './importUtils';
import styles from './ImportDialog.module.css';

interface ImportDialogProps {
  onImportDocument: (doc: DiagramDocument) => void;
  onImportShapes: (shapes: DiagramShape[], connectors: DiagramConnector[]) => void;
  onClose: () => void;
}

type Tab = 'file' | 'paste';

export function ImportDialog({ onImportDocument, onImportShapes, onClose }: ImportDialogProps) {
  const [tab, setTab] = useState<Tab>('file');
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    const text = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase();
    try {
      if (ext === 'json') {
        onImportDocument(importJSON(text));
        onClose();
      } else if (ext === 'xml' || ext === 'drawio') {
        onImportDocument(importDrawioXML(text));
        onClose();
      } else if (ext === 'mmd' || ext === 'md') {
        const { shapes, connectors } = importMermaid(text);
        onImportShapes(shapes, connectors);
        onClose();
      } else {
        // Sniff by content
        if (text.trim().startsWith('{')) {
          onImportDocument(importJSON(text));
          onClose();
        } else if (text.trim().startsWith('<')) {
          onImportDocument(importDrawioXML(text));
          onClose();
        } else {
          const { shapes, connectors } = importMermaid(text);
          onImportShapes(shapes, connectors);
          onClose();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to import file');
    }
  }

  function handlePasteImport() {
    setError(null);
    const text = pasteText.trim();
    if (!text) return;
    try {
      if (text.startsWith('{')) {
        onImportDocument(importJSON(text));
        onClose();
      } else if (text.startsWith('<')) {
        onImportDocument(importDrawioXML(text));
        onClose();
      } else {
        const { shapes, connectors } = importMermaid(text);
        onImportShapes(shapes, connectors);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse content');
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Import Diagram</h2>

        <div className={styles.tabs}>
          <button className={`${styles.tab} ${tab === 'file' ? styles.active : ''}`} onClick={() => setTab('file')}>File</button>
          <button className={`${styles.tab} ${tab === 'paste' ? styles.active : ''}`} onClick={() => setTab('paste')}>Paste Text</button>
        </div>

        {tab === 'file' ? (
          <>
            <div
              className={`${styles.dropZone} ${dragOver ? styles.dragOver : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
            >
              <div className={styles.dropLabel}>Click or drag a file here</div>
              <div className={styles.dropHint}>.json, .xml, .drawio, .mmd, .md</div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className={styles.fileInput}
              accept=".json,.xml,.drawio,.md,.mmd"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
          </>
        ) : (
          <>
            <textarea
              className={styles.textarea}
              placeholder="Paste Mermaid, Draw.io XML, or Neutrino JSON here…"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <p className={styles.hint}>Supports: Mermaid flowchart, Draw.io XML, Neutrino JSON</p>
          </>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          {tab === 'paste' && (
            <button className={styles.importBtn} onClick={handlePasteImport} disabled={!pasteText.trim()}>
              Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
