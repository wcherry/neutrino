'use client';

/**
 * What was found, where each kind goes, which folder it lands in, and the one
 * Import button.
 */

import React, { useState } from 'react';
import { Folder } from 'lucide-react';
import { Alert, Button, Select } from '@neutrino/ui';
import { MoveFolderDialog } from '@/app/(apps)/drive/MoveFolderDialog';
import {
  DESTINATION_OPTIONS,
  IMPORT_KINDS,
  KIND_LABELS,
  type Destination,
} from '@/lib/localImport';
import { formatBytes } from '@/lib/takeout/log';
import { pickedLabel, type UseLocalImportResult } from './useLocalImport';
import styles from './LocalImport.module.css';

const filesLabel = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'file' : 'files'}`;

export interface LocalImportSummaryProps {
  local: UseLocalImportResult;
  /** Why starting is not possible right now (another import is running), if it is not. */
  blockedReason: string | null;
  onStart(): void;
}

export function LocalImportSummary({ local, blockedReason, onStart }: LocalImportSummaryProps) {
  const [choosingFolder, setChoosingFolder] = useState(false);
  const { scan, choice, folder, fileCount, bytes, quotaCheck } = local;
  if (!scan) return null;

  const label = pickedLabel(scan);
  const found = scan.roots.length > 0 ? `Found in ${label}` : `${label} chosen`;
  const kinds = IMPORT_KINDS.filter((kind) => scan.byKind[kind].count > 0);

  return (
    <section className={styles.summary} aria-label="What will be imported">
      <div className={styles.foundBox}>
        <div className={styles.foundTitle}>{found}</div>
        <div className={styles.foundMeta}>
          {filesLabel(scan.files.length)} · {formatBytes(scan.totalBytes)}
        </div>
      </div>

      {kinds.length > 0 && (
        <div className={styles.kinds}>
          {kinds.map((kind) => (
            <div key={kind} className={styles.kind}>
              <div className={styles.kindLabel}>{KIND_LABELS[kind]}</div>
              <div className={styles.kindCount}>
                {filesLabel(scan.byKind[kind].count)} · {formatBytes(scan.byKind[kind].bytes)}
              </div>
              <Select
                size="sm"
                aria-label={`Destination for ${KIND_LABELS[kind]}`}
                value={choice[kind]}
                options={DESTINATION_OPTIONS[kind]}
                onChange={(e) => local.setDestination(kind, e.target.value as Destination)}
              />
            </div>
          ))}
        </div>
      )}

      <div className={styles.saveIn}>
        <span className={styles.saveInLabel}>Save in</span>
        <span className={styles.saveInFolder}>
          <Folder size={14} aria-hidden="true" />
          {folder.name}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setChoosingFolder(true)}>
          Change…
        </Button>
      </div>

      {scan.ignored > 0 && (
        <p className={styles.note}>
          {scan.ignored.toLocaleString()} system {scan.ignored === 1 ? 'file' : 'files'} like .DS_Store{' '}
          {scan.ignored === 1 ? 'is' : 'are'} left out.
        </p>
      )}

      {!quotaCheck.ok && <Alert variant="warning" message={quotaCheck.message} />}
      {local.error && <Alert variant="error" message={local.error} />}
      {blockedReason && <Alert variant="info" message={blockedReason} />}

      <div className={styles.actions}>
        <Button onClick={onStart} disabled={!local.canStart || !!blockedReason}>
          Import {filesLabel(fileCount)}
        </Button>
        <span className={styles.actionsHint}>
          {fileCount > 0 && `${formatBytes(bytes)} · `}Runs in the background — go on to the next step or finish
          setup while it uploads.
        </span>
        <Button variant="ghost" size="sm" onClick={local.clear}>
          Clear
        </Button>
      </div>

      {choosingFolder && (
        <MoveFolderDialog
          itemName={label}
          title="Choose where to import"
          confirmLabel="Import here"
          allowCurrentLocation
          currentFolderId={folder.id}
          onPick={(picked) => {
            local.setFolder(picked);
            setChoosingFolder(false);
          }}
          onClose={() => setChoosingFolder(false)}
        />
      )}
    </section>
  );
}
