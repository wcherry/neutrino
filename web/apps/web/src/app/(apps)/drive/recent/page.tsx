'use client';

import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Heading, EmptyState, FileGrid, type GridItem, type SortDir, type SortField } from '@neutrino/ui';
import { Clock } from 'lucide-react';
import { filesystemApi, type FileItem } from '@/lib/api';
import { fileToGridItem, sortEntries } from '../gridItems';
import { routeForFile } from '../routeForFile';
import { PreviewModal } from '../PreviewModal';
import styles from '../shared/page.module.css';
import { useListingView } from '@/lib/listingViews';

export default function RecentPage() {
  const router = useRouter();
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  // Remembered per listing and synced, so this is also its default view (U9, lib/listingViews.ts).
  const listing = useListingView('recent', { view: 'large', sort: 'updatedAt', dir: 'desc', flowView: 'list' });
  const sortBy = listing.sort;
  const sortDir = listing.dir;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['recent'],
    queryFn: () => filesystemApi.getRecent({ limit: 50 }),
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
        viewMode={listing.view}
        onViewModeChange={listing.setView}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={listing.setSort}
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
