'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  History,
  Calendar,
  HardDrive,
  Tag,
} from 'lucide-react';
import { Text, Heading, Spinner } from '@neutrino/ui';
import { storageApi, type FileItem } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import styles from './FileInfoPanel.module.css';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}


interface Props {
  file: FileItem;
  onClose: () => void;
}

export function FileInfoPanel({ file, onClose }: Props) {
  const { data: versionsData, isLoading: versionsLoading } = useQuery({
    queryKey: ['file-versions', file.id],
    queryFn: () => storageApi.listVersions(file.id),
    staleTime: 60_000,
  });

  const IconComponent = getFileIcon(file.mimeType);
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : 'Unknown';

  return (
    <aside className={styles.panel} aria-label="File information">
      <div className={styles.header}>
        <Heading level={3} size="sm">File info</Heading>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close file info"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.iconArea}>
        <div className={styles.fileIcon} style={{ color: getIconColor(file.mimeType) }}>
          <IconComponent size={48} strokeWidth={1} />
        </div>
        <Text weight="medium" size="sm" truncate >
          {file.name}
        </Text>
      </div>

      <div className={styles.section}>
        <Text
          size="xs"
          color="muted"
          weight="semibold"
        >
          Details
        </Text>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt>
              <HardDrive size={13} />
              Size
            </dt>
            <dd>{formatFileSize(file.sizeBytes)}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <Tag size={13} />
              Type
            </dt>
            <dd>{ext}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <Calendar size={13} />
              Created
            </dt>
            <dd>{formatDate(file.createdAt)}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <Calendar size={13} />
              Modified
            </dt>
            <dd>{formatDate(file.updatedAt)}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <History size={13} />
              Versions
            </dt>
            <dd>
              {versionsLoading ? (
                <Spinner size="sm" />
              ) : (
                versionsData?.total ?? 0
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className={styles.section}>
        <Text
          size="xs"
          color="muted"
          weight="semibold"
        >
          MIME type
        </Text>
        <Text size="xs" color="muted">
          {file.mimeType}
        </Text>
      </div>
    </aside>
  );
}
