'use client';

import React, { useCallback, useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckCircle, AlertCircle, File } from 'lucide-react';
import { authApi, storageApi, uploadEncryptedFile } from '@/lib/api';
import { useUser } from '@neutrino/auth';
import { DropZone } from '@neutrino/ui';
import {
  initSodium,
  generateFileKey,
  encryptFileKey,
  encryptMetadata,
  loadKeyPair,
} from '@neutrino/e2e-crypto';
import styles from './UploadZone.module.css';

interface UploadEntry {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface UploadZoneProps {
  onClose: () => void;
  folderId?: string | null;
  /** Files to enqueue immediately on mount (e.g. dropped onto the drive area). */
  initialFiles?: File[];
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UploadZone({ onClose, folderId, initialFiles }: UploadZoneProps) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const currentUser = useUser();

  const updateEntry = useCallback((id: string, patch: Partial<UploadEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const { mutate: uploadFile } = useMutation({
    mutationFn: async ({ entry }: { entry: UploadEntry }) => {
      // Attempt E2EE upload whenever we can resolve the current user's local keypair.
      const userId = currentUser?.id ?? (await authApi.getProfile().then((user) => user.id).catch(() => null));
      if (userId) {
        await initSodium();
        const kp = loadKeyPair(userId);
        if (kp) {
          const dek = generateFileKey();
          const encryptedFileKey = encryptFileKey(dek, kp.publicKey);
          const encryptedMetadata = encryptMetadata(
            { name: entry.file.name, mimeType: entry.file.type || 'application/octet-stream' },
            dek,
          );
          return uploadEncryptedFile(
            entry.file,
            dek,
            encryptedFileKey,
            encryptedMetadata,
            (progress) => updateEntry(entry.id, { progress, status: 'uploading' }),
            folderId,
          );
        }
      }
      // Fallback: plaintext upload (no keypair available).
      return storageApi.uploadFile(
        entry.file,
        (progress) => updateEntry(entry.id, { progress, status: 'uploading' }),
        folderId,
      );
    },
    onSuccess: (_data, { entry }) => {
      updateEntry(entry.id, { status: 'done', progress: 100 });
      queryClient.invalidateQueries({ queryKey: ['contents'] });
    },
    onError: (err, { entry }) => {
      updateEntry(entry.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    },
  });

  const enqueueFiles = useCallback(
    (files: File[]) => {
      const newEntries: UploadEntry[] = files.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        progress: 0,
        status: 'pending',
      }));
      setEntries((prev) => [...prev, ...newEntries]);
      newEntries.forEach((entry) => uploadFile({ entry }));
    },
    [uploadFile]
  );

  // Enqueue any files that were dropped onto the drive area before the zone opened.
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0) {
      enqueueFiles(initialFiles);
    }
    // Only run on mount — initialFiles reference is stable (passed from drop handler).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const allDone = entries.length > 0 && entries.every((e) => e.status === 'done' || e.status === 'error');
  const hasActive = entries.some((e) => e.status === 'uploading' || e.status === 'pending');

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Upload files">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Upload files</span>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
            disabled={hasActive}
          >
            <X size={18} />
          </button>
        </div>

        {/* Drop zone */}
        <DropZone
          onFiles={enqueueFiles}
          hint="or click to browse · up to 10 GB per file"
        />

        {/* Upload list */}
        {entries.length > 0 && (
          <ul className={styles.list} aria-label="Upload queue">
            {entries.map((entry) => (
              <li key={entry.id} className={styles.item}>
                <div className={styles.itemIcon}>
                  {entry.status === 'done' ? (
                    <CheckCircle size={18} className={styles.iconDone} />
                  ) : entry.status === 'error' ? (
                    <AlertCircle size={18} className={styles.iconError} />
                  ) : (
                    <File size={18} className={styles.iconFile} />
                  )}
                </div>
                <div className={styles.itemBody}>
                  <div className={styles.itemRow}>
                    <span className={styles.itemName}>{entry.file.name}</span>
                    <span className={styles.itemSize}>{formatFileSize(entry.file.size)}</span>
                    {(entry.status === 'done' || entry.status === 'error') && (
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => removeEntry(entry.id)}
                        aria-label={`Remove ${entry.file.name}`}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {entry.status === 'error' ? (
                    <p className={styles.itemError}>{entry.error}</p>
                  ) : (
                    <div className={styles.progressTrack} role="progressbar" aria-valuenow={entry.progress} aria-valuemin={0} aria-valuemax={100}>
                      <div
                        className={[
                          styles.progressBar,
                          entry.status === 'done' ? styles.progressDone : '',
                        ].filter(Boolean).join(' ')}
                        style={{ width: `${entry.progress}%` }}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Footer */}
        {entries.length > 0 && (
          <div className={styles.footer}>
            <span className={styles.footerStatus}>
              {hasActive
                ? `Uploading ${entries.filter((e) => e.status === 'uploading' || e.status === 'pending').length} file(s)…`
                : allDone
                ? `${entries.filter((e) => e.status === 'done').length} uploaded`
                : ''}
            </span>
            {allDone && (
              <button type="button" className={styles.doneBtn} onClick={onClose}>
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
