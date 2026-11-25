'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Heading, EmptyState, FileGrid, type GridItem } from '@neutrino/ui';
import { Clock } from 'lucide-react';
import { filesystemApi } from '@/lib/api';
import { fileToGridItem, sortEntries } from '../gridItems';
import { useFileActions, FileRail } from '../useFileActions';
import styles from '../shared/page.module.css';
import { useListingView } from '@/lib/listingViews';

export default function RecentPage() {
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

  // Drive's own actions — menu, star, share, move, rename, delete, bulk select, drag-in upload.
  // Recent lists only the caller's own files, so every one of them applies.
  const actions = useFileActions({ files });

  return (
    <FileRail actions={actions}>
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Recent</Heading>
      </div>

      <FileGrid
        items={items}
        isLoading={isLoading}
        isError={isError}
        {...actions.gridProps}
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

    </div>
      {actions.overlays}
    </FileRail>
  );
}
