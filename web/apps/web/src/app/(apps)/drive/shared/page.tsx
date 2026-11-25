'use client';

import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Heading,
  Text,
  EmptyState,
  FileGrid,
  type GridItem,
} from '@neutrino/ui';
import { Share2 } from 'lucide-react';
import { sharedWithMeApi } from '@/lib/api';
import { fileToGridItem, folderToGridItem, sortEntries } from '../gridItems';
import { useFileActions, FileRail } from '../useFileActions';
import styles from './page.module.css';
import { useListingView } from '@/lib/listingViews';

export default function SharedWithMePage() {
  // Remembered per listing and synced, so this is also its default view (U9, lib/listingViews.ts).
  const listing = useListingView('shared', { view: 'large', sort: 'name', dir: 'asc', flowView: 'list' });
  const sortBy = listing.sort;
  const sortDir = listing.dir;

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

  // Other people's files: the server lets only an owner rename, move, star, tag,
  // share or trash one, so the read-only set — open, preview, copy link, download.
  // A shared folder stays unopenable: My Drive can only list folders the caller owns.
  const actions = useFileActions({ files, folders, readOnly: true });

  return (
    <FileRail actions={actions}>
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
        {...actions.gridProps}
        viewMode={listing.view}
        onViewModeChange={listing.setView}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={listing.setSort}
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

    </div>
      {actions.overlays}
    </FileRail>
  );
}
