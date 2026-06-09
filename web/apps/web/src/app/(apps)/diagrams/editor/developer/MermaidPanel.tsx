'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { DiagramPage, DiagramShape, DiagramConnector } from '../../types';
import { diagramToMermaid, mermaidToDiagram } from './mermaidUtils';
import { parseArchCode } from './ArchCodePanel';
import styles from './MermaidPanel.module.css';

interface MermaidPanelProps {
  page: DiagramPage;
  onApplyShapes: (shapes: DiagramShape[], connectors: DiagramConnector[]) => void;
  onRunLayout: () => void;
}

export function MermaidPanel({ page, onApplyShapes, onRunLayout }: MermaidPanelProps) {
  const [subTab, setSubTab] = useState<'mermaid' | 'archcode'>('mermaid');
  const [mermaidText, setMermaidText] = useState('');
  const [archText, setArchText] = useState('');
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMermaidText(diagramToMermaid(page));
  }, [page]);

  function handleApplyMermaid() {
    setError(null);
    try {
      const { shapes, connectors } = mermaidToDiagram(mermaidText);
      onApplyShapes(shapes, connectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse error');
    }
  }

  function handleMermaidChange(value: string) {
    setMermaidText(value);
    if (!live) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setError(null);
      try {
        const { shapes, connectors } = mermaidToDiagram(value);
        onApplyShapes(shapes, connectors);
      } catch {
        // ignore live parse errors
      }
    }, 500);
  }

  function handleCopy() {
    navigator.clipboard.writeText(mermaidText).catch(() => {});
  }

  function handleApplyArch() {
    setError(null);
    try {
      const { shapes, connectors } = parseArchCode(archText);
      onApplyShapes(shapes, connectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse error');
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        Developer
      </div>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${subTab === 'mermaid' ? styles.active : ''}`} onClick={() => setSubTab('mermaid')}>
          Mermaid
        </button>
        <button className={`${styles.tab} ${subTab === 'archcode' ? styles.active : ''}`} onClick={() => setSubTab('archcode')}>
          Arch Code
        </button>
      </div>

      <div className={styles.content}>
        {subTab === 'mermaid' ? (
          <>
            <textarea
              className={styles.textarea}
              value={mermaidText}
              onChange={(e) => handleMermaidChange(e.target.value)}
              spellCheck={false}
            />
            <div className={styles.liveToggle}>
              <input
                type="checkbox"
                id="mermaid-live"
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
              />
              <label htmlFor="mermaid-live">Live</label>
            </div>
            <div className={styles.btnRow}>
              <button className={styles.btn} onClick={handleCopy}>Copy</button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleApplyMermaid}>Apply</button>
            </div>
          </>
        ) : (
          <>
            <textarea
              className={styles.archTextarea}
              value={archText}
              onChange={(e) => setArchText(e.target.value)}
              placeholder={`{\n  "nodes": [\n    { "id": "api", "label": "API", "type": "aws-api-gateway" }\n  ],\n  "edges": [\n    { "from": "api", "to": "db" }\n  ]\n}`}
              spellCheck={false}
            />
            <p className={styles.hint}>JSON with nodes + edges. Types map to diagram shape types.</p>
            <div className={styles.btnRow}>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleApplyArch}>Import</button>
              <button className={styles.btn} onClick={onRunLayout}>Layout</button>
            </div>
          </>
        )}
        {error && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
