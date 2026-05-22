'use client';

import React, { useState } from 'react';
import { History, RotateCcw, Tag, X, Check } from 'lucide-react';
import styles from './VersionHistoryPanel.module.css';

export interface VersionItem {
  id: string;
  versionNumber: number;
  sizeBytes: number;
  label: string | null;
  createdAt: string;
}

export interface VersionHistoryPanelProps {
  versions: VersionItem[];
  isLoading?: boolean;
  isError?: boolean;
  onClose: () => void;
  onLabelVersion: (versionId: string, label: string) => Promise<void>;
  onRestoreVersion: (versionId: string) => Promise<void>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function VersionHistoryPanel({
  versions,
  isLoading,
  isError,
  onClose,
  onLabelVersion,
  onRestoreVersion,
}: VersionHistoryPanelProps) {
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [labelPending, setLabelPending] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  function startLabel(v: VersionItem) {
    setEditingLabel(v.id);
    setLabelInput(v.label ?? '');
  }

  async function submitLabel(versionId: string) {
    const label = labelInput.trim();
    if (!label) { setEditingLabel(null); return; }
    setLabelPending(true);
    try {
      await onLabelVersion(versionId, label);
      setEditingLabel(null);
    } finally {
      setLabelPending(false);
    }
  }

  async function handleRestore(versionId: string) {
    setRestoringId(versionId);
    try {
      await onRestoreVersion(versionId);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <History size={16} />
          Version history
        </div>
        <button className={styles.closeBtn} onClick={onClose} title="Close">
          <X size={16} />
        </button>
      </div>

      <div className={styles.list}>
        {isLoading && <div className={styles.empty}>Loading versions…</div>}
        {isError && (
          <div className={styles.empty} style={{ color: 'var(--color-danger, #dc2626)' }}>
            Failed to load version history.
          </div>
        )}
        {!isLoading && !isError && versions.length === 0 && (
          <div className={styles.empty}>No versions yet.</div>
        )}
        {versions.map((v, idx) => (
          <div key={v.id} className={styles.versionRow}>
            <div className={styles.versionMeta}>
              <div className={styles.versionNum}>
                v{v.versionNumber}
                {idx === 0 && <span className={styles.currentBadge}>Current</span>}
              </div>
              <div className={styles.versionDate}>{formatDate(v.createdAt)}</div>
              <div className={styles.versionSize}>{formatBytes(v.sizeBytes)}</div>
            </div>

            {editingLabel === v.id ? (
              <div className={styles.labelRow}>
                <input
                  className={styles.labelInput}
                  value={labelInput}
                  onChange={e => setLabelInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') submitLabel(v.id);
                    if (e.key === 'Escape') setEditingLabel(null);
                  }}
                  autoFocus
                  placeholder="Version name…"
                />
                <button className={styles.iconBtn} onClick={() => submitLabel(v.id)} disabled={labelPending}>
                  <Check size={13} />
                </button>
                <button className={styles.iconBtn} onClick={() => setEditingLabel(null)}>
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className={styles.labelRow}>
                {v.label && <span className={styles.labelBadge}>{v.label}</span>}
                <button className={styles.actionBtn} onClick={() => startLabel(v)} title="Name this version">
                  <Tag size={12} />
                  {v.label ? 'Rename' : 'Name'}
                </button>
                {idx !== 0 && (
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleRestore(v.id)}
                    disabled={restoringId === v.id}
                    title="Restore this version"
                  >
                    <RotateCcw size={12} />
                    {restoringId === v.id ? 'Restoring…' : 'Restore'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
