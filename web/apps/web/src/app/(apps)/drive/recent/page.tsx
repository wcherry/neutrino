'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Heading, EmptyState, FileGrid, type GridItem, type SortDir, type SortField } from '@neutrino/ui';
import { Clock } from 'lucide-react';
import { filesystemApi, type FileItem } from '@/lib/api';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { fileToGridItem, sortEntries } from '../gridItems';
import { routeForFile } from '../routeForFile';
import { PreviewModal } from '../PreviewModal';
import styles from '../shared/page.module.css';

export default function RecentPage() {
  const router = useRouter();
  const flags = useFeatureFlags();
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recent'],
    queryFn: () => filesystemApi.getRootContents({ view: 'recent', limit: 50 }),
  });

  const files = useMemo(() => data?.files ?? [], [data]);
  const items: GridItem[] = useMemo(
    () => sortEntries(files, sortBy, sortDir).map(fileToGridItem),
    [files, sortBy, sortDir],
  );

  function openItem(item: GridItem) {
    const file = files.find((f) => f.id === item.id);
    if (!file) return;
    routeForFile(file, router, {
      officeInPlaceEditingEnabled: flags.officeInPlaceEditing,
      onPreviewFallback: () => setPreviewFile(file),
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Recent</Heading>
      </div>

      <FileGrid
        items={items}
        isLoading={isLoading}
        isError={isError}
        onItemClick={openItem}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : files.length}
        emptyState={
          isError ? (
            <EmptyState
              title="Could not load recent files"
              description="There was an error loading your recent files."
            />
          ) : (
            <EmptyState
              icon={Clock}
              title="No recent files"
              description="Files you open or edit will appear here."
            />
          )
        }
      />

      {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
    </div>
  );
}
