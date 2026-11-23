'use client';

import React, { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Heading, EmptyState, FileGrid, type GridItem } from '@neutrino/ui';
import { Star } from 'lucide-react';
import { filesystemApi } from '@/lib/api';
import { fileToGridItem, folderToGridItem, sortEntries } from '../gridItems';
import { useFileActions, FileRail } from '../useFileActions';
import styles from '../shared/page.module.css';
import { useListingView } from '@/lib/listingViews';

export default function StarredPage() {
  const router = useRouter();
  // Remembered per listing and synced, so this is also its default view (U9, lib/listingViews.ts).
  const listing = useListingView('starred', { view: 'large', sort: 'name', dir: 'asc', flowView: 'list' });
  const sortBy = listing.sort;
  const sortDir = listing.dir;

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

  // A starred folder opens in My Drive, which keeps the open folder in the URL.
  const openFolder = useCallback(
    (folder: { id: string }) => router.push(`/drive?folder=${encodeURIComponent(folder.id)}`),
    [router],
  );
  // Drive's own actions. Starred lists only the caller's own files and folders,
  // so every one of them applies — including taking the star off.
  const actions = useFileActions({ files, folders, onOpenFolder: openFolder });

  return (
    <FileRail actions={actions}>
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Starred</Heading>
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

    </div>
      {actions.overlays}
    </FileRail>
  );
}
