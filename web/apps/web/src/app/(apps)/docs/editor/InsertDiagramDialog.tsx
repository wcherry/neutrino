'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { diagramsApi } from '@neutrino/api-drawing';
import styles from './InsertDiagramDialog.module.css';

interface InsertDiagramDialogProps {
  onInsert: (diagramId: string, title: string) => void;
  onClose: () => void;
}

export function InsertDiagramDialog({ onInsert, onClose }: InsertDiagramDialogProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['diagrams'],
    queryFn: () => diagramsApi.listDiagrams(),
  });

  const diagrams = data?.diagrams ?? [];

  function handleInsert() {
    if (!selected) return;
    const d = diagrams.find((x) => x.id === selected);
    onInsert(selected, d?.title ?? 'Diagram');
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Insert Diagram</h2>
        </div>

        <div className={styles.list}>
          {isLoading ? (
            <div className={styles.loading}>Loading diagrams…</div>
          ) : diagrams.length === 0 ? (
            <div className={styles.empty}>No diagrams found. Create one in Diagrams.</div>
          ) : (
            diagrams.map((d) => (
              <button
                key={d.id}
                className={`${styles.item} ${selected === d.id ? styles.selected : ''}`}
                onClick={() => setSelected(d.id)}
              >
                <span className={styles.itemName}>{d.title}</span>
              </button>
            ))
          )}
        </div>

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.insertBtn} onClick={handleInsert} disabled={!selected}>
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
