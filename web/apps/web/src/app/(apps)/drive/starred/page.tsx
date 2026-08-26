'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Heading, EmptyState, FileGrid, type GridItem, type SortDir, type SortField } from '@neutrino/ui';
import { Star } from 'lucide-react';
import { filesystemApi, type FileItem } from '@/lib/api';
import { fileToGridItem, folderToGridItem, sortEntries } from '../gridItems';
import { routeForFile } from '../routeForFile';
import { PreviewModal } from '../PreviewModal';
import styles from '../shared/page.module.css';

export default function StarredPage() {
  const router = useRouter();
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['starred-page'],
    queryFn: () => filesystemApi.getStarred(50),
  });

  const files = useMemo(() => data?.files ?? [], [data]);
  const folders = useMemo(() => data?.folders ?? [], [data]);

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
    // component state — so a starred folder has nowhere to navigate to.
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
        <Heading level={1} size="xl">Starred</Heading>
      </div>

      <FileGrid
        items={items}
        isLoading={isLoading}
        isError={isError}
        onItemClick={openItem}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : files.length + folders.length}
        emptyState={
          isError ? (
            <EmptyState
              title="Could not load starred items"
              description="There was an error loading your starred files and folders."
            />
          ) : (
            <EmptyState
              icon={Star}
              title="No starred files"
              description="Star files and folders to quickly find them here."
            />
          )
        }
      />

      {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
