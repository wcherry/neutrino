'use client';

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { storageApi } from '@/lib/api';
import { VersionHistoryPanel as VersionHistoryPanelUI } from '@neutrino/ui';
import type { FileVersionItem } from '@neutrino/api-drive';
import styles from './VersionHistoryPanel.module.css';

interface VersionHistoryPanelProps {
  fileId: string;
  onRestore?: () => void;
  onClose?: () => void;
  /** False inside a `Panel` (a `PanelRail`), which draws the frame; see the shared panel. */
  framed?: boolean;
  /** When true, shows a "Compare" button for each version (docsCompare flag). */
  compareEnabled?: boolean;
  /** Called when the user clicks "Compare" on a version. */
  onCompare?: (version: FileVersionItem) => void;
}

export function VersionHistoryPanel({
  fileId,
  onRestore,
  onClose,
  framed = true,
  compareEnabled,
  onCompare,
}: VersionHistoryPanelProps) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['versions', fileId],
    queryFn: () => storageApi.listVersions(fileId),
    staleTime: 10_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['versions', fileId] });

  const versions = data?.versions ?? [];

  return (
    <div className={framed ? styles.wrapper : undefined}>
      <VersionHistoryPanelUI
        versions={versions}
        isLoading={isLoading}
        isError={isError}
        onClose={onClose}
        framed={framed}
        onLabelVersion={async (versionId, label) => {
          await storageApi.labelVersion(fileId, versionId, label);
          invalidate();
        }}
        onRestoreVersion={async (versionId) => {
          await storageApi.restoreVersion(fileId, versionId);
          invalidate();
          onRestore?.();
        }}
      />

      {/* Compare buttons injected below the standard panel list */}
      {compareEnabled && onCompare && versions.length >= 2 && (
        <div className={styles.compareSection}>
          <div className={styles.compareSectionTitle}>Compare with current</div>
          {versions.slice(1).map(v => (
            <button
              key={v.id}
              className={styles.compareBtn}
              onClick={() => onCompare(v)}
              type="button"
            >
              Compare v{v.versionNumber}
              {v.label ? ` — ${v.label}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
