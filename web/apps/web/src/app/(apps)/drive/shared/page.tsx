'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Heading,
  Text,
  EmptyState,
  FileGrid,
  type GridItem,
  type SortDir,
  type SortField,
} from '@neutrino/ui';
import { Share2 } from 'lucide-react';
import { sharedWithMeApi, type FileItem } from '@/lib/api';
import { fileToGridItem, folderToGridItem, sortEntries } from '../gridItems';
import { routeForFile } from '../routeForFile';
import { PreviewModal } from '../PreviewModal';
import styles from './page.module.css';

export default function SharedWithMePage() {
  const router = useRouter();
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['shared-with-me'],
    queryFn: () => sharedWithMeApi.list(),
  });

  const files = useMemo(() => data?.files ?? [], [data]);
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const total = files.length + folders.length;

  // Folders first, as on My Drive; each group ordered by the current sort.
  const items: GridItem[] = useMemo(
    () => [
      ...sortEntries(folders, sortBy, sortDir).map(folderToGridItem),
      ...sortEntries(files, sortBy, sortDir).map(fileToGridItem),
    ],
    [files, folders, sortBy, sortDir],
  );

  function openItem(item: GridItem) {
    // Folders are not addressable by URL — My Drive tracks the open folder in
    // component state — so a shared folder has nowhere to navigate to.
    if (item.kind === 'folder') return;
    const file = files.find((f) => f.id === item.id);
    if (!file) return;
    routeForFile(file, router, {
      onPreviewFallback: () => setPreviewFile(file),
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Shared with me</Heading>
        {!isLoading && !isError && (
          <Text size="sm" color="muted">{total} item{total !== 1 ? 's' : ''}</Text>
        )}
      </div>

      <FileGrid
        items={items}
        isLoading={isLoading}
        isError={isError}
        onItemClick={openItem}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : total}
        emptyState={
          isError ? (
            <EmptyState
              title="Could not load shared files"
              description="There was an error loading files shared with you."
            />
          ) : (
            <EmptyState
              icon={Share2}
              title="Nothing shared with you yet"
              description="Files and folders others share with you will appear here."
            />
          )
        }
      />

      {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
