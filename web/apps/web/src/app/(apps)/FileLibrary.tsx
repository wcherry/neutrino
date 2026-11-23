'use client';

/**
 * Every app library — `/docs`, `/sheets`, `/slides`, `/drawing`, `/diagrams`
 * and `/notes` — is this page.
 *
 * It is My Drive narrowed to one kind of file: the same listing endpoint
 * (`GET /api/v1/drive/files`, sorted and paged by the server), the same card
 * mapping (`fileToGridItem`), the same grid and the same actions
 * (`useFileActions`). A library differs from another only in its row of
 * `FILE_LIBRARIES` — the filter it sends and the words around it — so a
 * spreadsheet looks and behaves the same in `/sheets` as it does in Drive.
 *
 * It replaced `DocumentLibrary` and the hand-written Notes page, which each
 * fetched through a per-app list call that kept only id, title and dates, so
 * their cards had no thumbnail, size or star, their sort bar sorted nothing,
 * and they stopped at the first 200 files.
 */

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FilePlus } from 'lucide-react';
import { Button, EmptyState, FileGrid, Heading, Text, useToast } from '@neutrino/ui';
import { usePreference } from '@neutrino/preferences';
import { storageApi, type FileItem } from '@/lib/api';
import { FILE_LIBRARIES, type FileLibraryId } from '@/lib/fileLibraries';
import { createNewItem } from '@/lib/newItems';
import { useListingView } from '@/lib/listingViews';
import { fileToGridItem } from './drive/gridItems';
import { useFileActions, FileRail, fileActionStyles } from './drive/useFileActions';
import { useLoadMore } from './drive/useLoadMore';
import styles from './FileLibrary.module.css';

/** Files fetched per request; more are pulled in as the grid is scrolled. */
export const LIBRARY_PAGE_SIZE = 100;

/** The React Query root every library listing lives under (see `LISTING_QUERY_KEYS`). */
export const FILE_LIBRARY_QUERY_ROOT = 'file-library';

export interface FileLibraryProps {
  library: FileLibraryId;
  /** Further controls beside the create button — Docs puts New from template here. */
  headerActions?: React.ReactNode;
  /** What the create button does instead of creating straight away — Diagrams opens its template picker. */
  onCreate?: () => void;
}

export function FileLibrary({ library, headerActions, onCreate }: FileLibraryProps) {
  const config = FILE_LIBRARIES[library];
  const router = useRouter();
  const toast = useToast();
  // Remembered per listing and synced, so this is also its default view (U9, lib/listingViews.ts).
  const listing = useListingView(library, { view: 'large', sort: 'updatedAt', dir: 'desc', flowView: 'list' });
  // The new looks: the library is one region — title, controls and list together (Drive boards).
  const [look] = usePreference('appearance.look');
  const flow = look !== 'classic';

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: [FILE_LIBRARY_QUERY_ROOT, library, { orderBy: listing.sort, direction: listing.dir }],
    queryFn: ({ pageParam }) =>
      storageApi.listFiles({
        ...config.filter,
        orderBy: listing.sort,
        direction: listing.dir,
        limit: LIBRARY_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return lastPage.items.length === LIBRARY_PAGE_SIZE && loaded < lastPage.total ? loaded : undefined;
    },
    // Re-read on every visit, as My Drive does: an editor renames or creates its
    // file and navigates here without touching this query.
    staleTime: 0,
  });

  const files: FileItem[] = useMemo(() => data?.pages.flatMap((p) => p.items) ?? [], [data]);
  const total = data?.pages[0]?.total;
  const gridItems = useMemo(() => files.map(fileToGridItem), [files]);
  const setLoadMoreEl = useLoadMore(!!hasNextPage, isFetchingNextPage, fetchNextPage);

  const actions = useFileActions({ files });

  const [creating, setCreating] = useState(false);
  async function create() {
    if (onCreate) { onCreate(); return; }
    setCreating(true);
    try {
      router.push(await createNewItem(config.newItem));
    } catch {
      toast.error(`Failed to create ${config.noun}`);
      setCreating(false);
    }
  }

  const newButton = (
    <Button onClick={create} disabled={creating} icon={<FilePlus size={16} />}>
      New {config.noun}
    </Button>
  );

  return (
    <FileRail actions={actions}>
      <div className={styles.page} data-own-regions={flow || undefined}>
        <div className={styles.header}>
          {flow ? <h1 className={styles['page-title']}>{config.title}</h1> : <Heading level={1} size="xl">{config.title}</Heading>}
          <div className={styles['header-actions']}>
            {headerActions}
            {newButton}
          </div>
        </div>

        <FileGrid
          items={gridItems}
          isLoading={isLoading}
          isError={isError}
          emptyState={
            isError ? (
              <EmptyState
                title={`Could not load ${config.noun}s`}
                description="There was an error loading your files. Please try again."
                action={<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Retry</Button>}
              />
            ) : (
              <EmptyState
                icon={config.icon}
                title={`No ${config.noun}s yet`}
                description={`Create a new ${config.noun} to get started.`}
                action={newButton}
              />
            )
          }
          {...actions.gridProps}
          showFilter={false}
          viewMode={listing.view}
          onViewModeChange={listing.setView}
          sortBy={listing.sort}
          sortDir={listing.dir}
          onSortChange={listing.setSort}
          totalCount={isLoading ? undefined : total}
          footer={
            hasNextPage ? (
              <div ref={setLoadMoreEl} className={fileActionStyles['load-more']} aria-live="polite">
                {isFetchingNextPage && <Text size="sm" color="muted">Loading more…</Text>}
              </div>
            ) : undefined
          }
        />
      </div>
      {actions.overlays}
    </FileRail>
  );
}
