'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Heading,
  Text,
  Card,
  EmptyState,
  FileListSkeleton,
} from '@neutrino/ui';
import {
  Folder,
  Share2,
} from 'lucide-react';
import { sharedWithMeApi, type FileItem, type Folder as FolderItem } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import { useRouter } from 'next/navigation';
import { PreviewModal } from '../PreviewModal';
import styles from './page.module.css';

const DOC_MIME = 'application/x-neutrino-doc';
const SHEET_MIME = 'application/x-neutrino-sheet';
const SLIDES_MIME = 'application/x-neutrino-slide';
const DIAGRAM_MIME = 'application/x-neutrino-diagram';
const DRAWING_MIME = 'application/x-neutrino-drawing';


function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function SharedWithMePage() {
  const router = useRouter();
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  function openFile(file: FileItem) {
    if (file.mimeType === DOC_MIME) {
      router.push(`/docs/editor?id=${file.id}`);
    } else if (file.mimeType === SHEET_MIME) {
      router.push(`/sheets/editor?id=${file.id}`);
    } else if (file.mimeType === SLIDES_MIME) {
      router.push(`/slides/editor?id=${file.id}`);
    } else if (file.mimeType === DIAGRAM_MIME) {
      router.push(`/diagrams/editor?id=${file.id}`);
    } else if (file.mimeType === DRAWING_MIME) {
      router.push(`/drawing/editor?id=${file.id}`);
    } else {
      setPreviewFile(file);
    }
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: () => sharedWithMeApi.list(),
  });

  const files = data?.files ?? [];
  const folders = data?.folders ?? [];
  const total = files.length + folders.length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Shared with me</Heading>
        {!isLoading && !isError && (
          <Text size="sm" color="muted">{total} item{total !== 1 ? 's' : ''}</Text>
        )}
      </div>

      {isLoading ? (
        <FileListSkeleton rows={6} />
      ) : isError ? (
        <EmptyState
          title="Could not load shared files"
          description="There was an error loading files shared with you."
        />
      ) : total === 0 ? (
        <EmptyState
          icon={Share2}
          title="Nothing shared with you yet"
          description="Files and folders others share with you will appear here."
        />
      ) : (
        <div className={styles.grid} role="list">
          {folders.map((folder: FolderItem) => (
            <Card
              key={folder.id}
              hoverable
              padding="none"
              className={styles.card}
              role="listitem"
              tabIndex={0}
              aria-label={folder.name}
            >
              <div className={styles.preview} style={{ color: folder.color ?? 'var(--color-amber, #d97706)' }}>
                <Folder size={40} strokeWidth={1} />
              </div>
              <div className={styles.cardBody}>
                <Text size="sm" weight="medium" truncate>{folder.name}</Text>
                <Text size="xs" color="muted">Folder · {formatDate(folder.updatedAt)}</Text>
              </div>
            </Card>
          ))}
          {files.map((file: FileItem) => {
            const IconComponent = getFileIcon(file.mimeType);
            return (
              <Card
                key={file.id}
                hoverable
                padding="none"
                className={styles.card}
                role="listitem"
                tabIndex={0}
                aria-label={file.name}
                onClick={() => openFile(file)}
              >
                <div className={styles.preview} style={{ color: getIconColor(file.mimeType) }}>
                  <IconComponent size={40} strokeWidth={1} />
                </div>
                <div className={styles.cardBody}>
                  <Text size="sm" weight="medium" truncate>{file.name}</Text>
                  <Text size="xs" color="muted">
                    {formatFileSize(file.sizeBytes)} · {formatDate(file.updatedAt)}
                  </Text>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
