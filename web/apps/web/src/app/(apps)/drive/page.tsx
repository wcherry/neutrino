'use client';
// Intentionally a full client component: folder-navigation state (currentFolderId,
// folderPath) is shared by the breadcrumbs, heading, FileGrid, and every modal/overlay.
// There is no static server shell of non-trivial size to extract.

import dynamic from 'next/dynamic';
import React, { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heading,
  Text,
  Button,
  Breadcrumbs,
  EmptyState,
  useToast,
} from '@neutrino/ui';
import {
  Folder,
  Upload,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import { getCurrentUserId } from '@neutrino/api-core';
import { storageApi, filesystemApi, useUser, type FileItem, type Folder as FolderItem, type DriveFileType } from '@/lib/api';
import { invalidateDriveListings } from '@/lib/driveLiveUpdates';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClientSearch, type SearchHit } from '@/hooks/useClientSearch';
import { useSearchIndexUpdates } from '@/hooks/useSearchIndexUpdates';
import { DRIVE_SEARCH_PARAM, DRIVE_PREVIEW_PARAM } from './searchParams';
import { useDriveLivePhotos } from './useDriveLivePhotos';

// Only a folder with a Live Photo in it needs the hold gesture; it stays out of
// the route's first load (see `route-budgets.json`).
const LivePhotoMedia = dynamic(() => import('./LivePhotoMedia').then((m) => m.LivePhotoMedia), { ssr: false });
import { LocalImportDialog } from '@/components/LocalImport';
import { FileGrid, type GridItem, type FilterType } from '@neutrino/ui';
import { fileToGridItem, folderToGridItem } from './gridItems';
import { useFileActions, FileRail, NameDialog, fileActionStyles } from './useFileActions';
import { useLoadMore } from './useLoadMore';
import { usePreference } from '@neutrino/preferences';
import { QuickAccess } from './QuickAccess';
import { useQuickAccess } from '@/hooks/useQuickAccess';
import styles from './page.module.css';
import { useListingView } from '@/lib/listingViews';

/** Items fetched per request; more are pulled in as the grid is scrolled. */
const CONTENTS_PAGE_SIZE = 200;

/**
 * The `type` the folder endpoint should be asked for. The chip keys are the
 * backend's own category names, so this is a narrowing rather than a mapping —
 * `all` is the whole folder, and `starred` is not a kind of file at all, so the
 * grid keeps that one to itself.
 */
function fileTypeParam(filter: FilterType): DriveFileType | undefined {
  return filter === 'all' || filter === 'starred' ? undefined : filter;
}

export default function DrivePage() {
  // `useSearchParams` needs a Suspense boundary above it during prerender.
  return (
    <Suspense fallback={null}>
      <DriveContent />
    </Suspense>
  );
}

function DriveContent() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const currentUser = useUser();
  // The root folder's id is the user's id, and the access token already names it. Reading it from
  // there lets the listing start in parallel with `/auth/me` instead of after it — the first row
  // of My Drive was waiting a full round trip for an answer it already had (A2 in the performance
  // guide). The server still checks the token on the listing request itself.
  const [tokenUserId] = useState(getCurrentUserId);
  const ownerId = currentUser?.id ?? tokenUserId;
  const searchParams = useSearchParams();
  const searchTerm = (searchParams.get(DRIVE_SEARCH_PARAM) ?? '').trim();

  // Remembered per listing and synced, so this is also its default view (U9, lib/listingViews.ts).
  const listing = useListingView('drive', { view: 'large', sort: 'updatedAt', dir: 'desc', flowView: 'list' });
  const sortBy = listing.sort;
  const sortDir = listing.dir;
  const [filter, setFilter] = useState<FilterType>('all');
  // The open folder lives in the URL (`?folder=<id>`) so a refresh, a shared
  // link and the browser's back button all land on the same folder.
  const currentFolderId = searchParams.get('folder') || null;
  const [folderPath, setFolderPath] = useState<Array<{ id: string; name: string }>>([]);
  const setFolderParam = useCallback(
    (id: string | null) => router.push(id ? `/drive?folder=${encodeURIComponent(id)}` : '/drive'),
    [router],
  );

  // After a refresh or back/forward the URL names a folder the breadcrumb
  // knows nothing about: rebuild the trail by walking parents to the root.
  useEffect(() => {
    if (!currentFolderId) {
      setFolderPath((prev) => (prev.length ? [] : prev));
      return;
    }
    const idx = folderPath.findIndex((f) => f.id === currentFolderId);
    if (idx !== -1) {
      if (idx !== folderPath.length - 1) setFolderPath(folderPath.slice(0, idx + 1));
      return;
    }
    let cancelled = false;
    (async () => {
      const trail: Array<{ id: string; name: string }> = [];
      let id: string | null = currentFolderId;
      try {
        while (id && trail.length < 50) {
          const res = await filesystemApi.getFolderContents(id, { limit: 1 });
          if (!res.folder) break;
          trail.unshift({ id: res.folder.id, name: res.folder.name });
          id = res.folder.parentId;
        }
      } catch {
        // Keep whatever part of the trail was resolved.
      }
      if (!cancelled && trail.length) setFolderPath(trail);
    })();
    return () => { cancelled = true; };
  }, [currentFolderId, folderPath]);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  // New › Import folders: the local folder import, aimed at the open folder.
  const [importOpen, setImportOpen] = useState(false);

  // ── Search view (`/drive?q=…`) ───────────────────────────────────────────
  // Runs against the same client-side index the topbar drop-down uses, so the
  // full list here always agrees with the preview the user just saw.
  const { search } = useClientSearch();
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);

  /** Bumped when the index changes, to re-run the search below against it. */
  const [indexVersion, setIndexVersion] = useState(0);
  useSearchIndexUpdates(() => setIndexVersion((v) => v + 1));

  /** The term the hits on screen belong to, so a re-run doesn't flash empty. */
  const shownTermRef = useRef<string | null>(null);

  useEffect(() => {
    if (!searchTerm) {
      shownTermRef.current = null;
      setSearchHits(null);
      return;
    }
    let cancelled = false;
    // Only a new term clears the grid: re-running because the index changed
    // should replace the hits in place, not drop the user into a spinner.
    if (shownTermRef.current !== searchTerm) {
      shownTermRef.current = searchTerm;
      setSearchHits(null);
    }
    search(searchTerm)
      .then((hits) => { if (!cancelled) setSearchHits(hits); })
      .catch(() => { if (!cancelled) setSearchHits([]); });
    return () => { cancelled = true; };
  }, [searchTerm, search, indexVersion]);

  const clearSearch = useCallback(() => router.replace('/drive'), [router]);

  /**
   * Hits rendered as ordinary Drive items, so the search view is the same grid
   * (cards, list view, sorting, filter chips) as the rest of Drive.
   */
  const searchGridItems: GridItem[] = useMemo(() => {
    if (!searchHits) return [];
    const ordered = [...searchHits];
    // Relevance is the natural order; honour the grid's sort controls for the
    // two fields a hit actually carries.
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') ordered.sort((a, b) => a.title.localeCompare(b.title) * dir);
    else if (sortBy === 'updatedAt') ordered.sort((a, b) => (a.updatedAt - b.updatedAt) * dir);

    return ordered.map((hit) => ({
      id: hit.id,
      name: hit.title,
      kind: 'file' as const,
      icon: hit.icon,
      iconColor: hit.iconColor,
      subtitle: hit.subtitle,
      mimeType: hit.mimeType,
      typeText: hit.subtitle,
      modifiedText: hit.modified || '—',
      // A hit dates itself in epoch millis; `updatedAt` is ISO everywhere else.
      updatedAt: hit.updatedAt > 0 ? new Date(hit.updatedAt).toISOString() : undefined,
    }));
  }, [searchHits, sortBy, sortDir]);

  const handleSearchItemClick = useCallback((item: GridItem) => {
    const hit = searchHits?.find((h) => h.id === item.id);
    if (hit) router.push(hit.href);
  }, [searchHits, router]);

  // The new looks lay Drive out as the boards do (look-and-feel roadmap §5): Quick access as its
  // own region, then one region holding the folder's title, the controls and the list. Classic
  // keeps today's page layout; what Quick access lists is the same in both.
  const [look] = usePreference('appearance.look');
  const flow = look !== 'classic';
  const quickAccess = useQuickAccess({ enabled: !searchTerm });

  const {
    data: contentsData,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    // The chip is part of the key because it is answered in SQL: each one pages
    // through its own listing, rather than through the whole folder with the
    // misses dropped in the browser — which left a chip looking empty until
    // enough pages had been scrolled past to reach a file that matched.
    queryKey: ['contents', currentFolderId, ownerId, { orderBy: sortBy, direction: sortDir, type: fileTypeParam(filter) }],
    queryFn: ({ pageParam }) =>
      filesystemApi.getFolderContents(currentFolderId ?? ownerId!, {
        limit: CONTENTS_PAGE_SIZE,
        offset: pageParam,
        orderBy: sortBy,
        direction: sortDir,
        type: fileTypeParam(filter),
      }),
    initialPageParam: 0,
    // The endpoint paginates subfolders and files independently — the same
    // offset is applied to each list — so a page is only the last one when
    // both came back short.
    getNextPageParam: (lastPage, _pages, lastOffset) =>
      lastPage.folders.length === CONTENTS_PAGE_SIZE || lastPage.files.length === CONTENTS_PAGE_SIZE
        ? lastOffset + CONTENTS_PAGE_SIZE
        : undefined,
    enabled: !!currentFolderId || !!ownerId,
    // Re-read the folder every time this page is mounted, rather than trusting
    // the global one-minute `staleTime` (see `QueryProvider`). The mutations on
    // this page invalidate the listing themselves, but the ones that change it
    // from somewhere else cannot all be enumerated here — every editor renames
    // its own file, the FAB creates one before navigating away from Drive
    // entirely — and each of those left the user looking at a folder as it was
    // before, for the rest of that minute. The cached copy is still shown while
    // the read is in flight, so this costs a request, not a spinner.
    staleTime: 0,
  });

  // Folders across all pages first, then files across all pages: the grid puts
  // folders ahead of files, and concatenating page by page would interleave the
  // two once a second page arrived.
  const pages = contentsData?.pages;
  const folders: FolderItem[] = useMemo(() => pages?.flatMap((p) => p.folders) ?? [], [pages]);
  const files: FileItem[] = useMemo(() => pages?.flatMap((p) => p.files) ?? [], [pages]);

  // ── Infinite scroll ──────────────────────────────────────────────────────
  const setLoadMoreEl = useLoadMore(!!hasNextPage, isFetchingNextPage, fetchNextPage);

  // Live Photos (issue #316): a still whose clip is found gets a tile that
  // loops the clip while held. The video file stays in the listing as itself.
  const liveClips = useDriveLivePhotos(files);

  const gridItems: GridItem[] = useMemo(
    () => [
      ...folders.map(folderToGridItem),
      ...files.map((file) => {
        const item = fileToGridItem(file);
        const clip = liveClips.get(file.id);
        if (!clip) return item;
        const Icon = item.icon;
        return {
          ...item,
          media: (
            <LivePhotoMedia
              variant="tile"
              stillId={file.id}
              clip={clip}
              src={item.thumbnailUrl ?? null}
              alt={file.name}
              fallback={<Icon size={40} strokeWidth={1} />}
            />
          ),
        };
      }),
    ],
    [folders, files, liveClips]
  );

  const openFolder = useCallback((folder: FolderItem) => {
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setFolderParam(folder.id);
  }, [setFolderParam]);

  function navigateTo(index: number) {
    if (index === -1) {
      setFolderPath([]);
      setFolderParam(null);
    } else {
      const target = folderPath[index];
      setFolderPath((prev) => prev.slice(0, index + 1));
      setFolderParam(target.id);
    }
  }

  // Open, menu, star, share, move, rename, delete, download, bulk select and
  // drag-in upload — the same set every listing of Drive files offers.
  const actions = useFileActions({
    files,
    folders,
    onOpenFolder: openFolder,
    uploadFolderId: currentFolderId,
    currentFolderId,
  });
  const { openUpload } = actions;

  // ── Deep-linked preview (`/drive?preview=<file id>`) ─────────────────────
  // Where an `/open/file/<id>` Universal Link lands when the file has no editor of its own — see
  // `open/appLink.ts`. Fetched by id rather than looked up in `files`, because the link routinely
  // names a file in a folder this session has never listed.
  const previewParam = searchParams.get(DRIVE_PREVIEW_PARAM);
  useEffect(() => {
    if (!previewParam) return;
    let cancelled = false;
    storageApi
      .getFileMetadata(previewParam)
      .then((file) => { if (!cancelled) actions.showPreview(file); })
      .catch(() => { if (!cancelled) toast.error('That file could not be opened'); });
    return () => { cancelled = true; };
    // `toast` is deliberately not a dependency: it is recreated on every render, and re-running
    // this would refetch the file each time anything on the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewParam]);

  useEffect(() => {
    function onNewFolder() { setNewFolderDialogOpen(true); }
    function onUpload() { openUpload(); }
    function onImportFolders() { setImportOpen(true); }
    window.addEventListener('drive:new-folder', onNewFolder);
    window.addEventListener('drive:upload', onUpload);
    window.addEventListener('drive:import-folders', onImportFolders);
    return () => {
      window.removeEventListener('drive:new-folder', onNewFolder);
      window.removeEventListener('drive:upload', onUpload);
      window.removeEventListener('drive:import-folders', onImportFolders);
    };
  }, [openUpload]);

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => filesystemApi.createFolder({ name, parentId: currentFolderId ?? undefined }),
    onSuccess: () => {
      invalidateDriveListings(queryClient);
      setNewFolderDialogOpen(false);
    },
    onError: () => toast.error('Failed to create folder'),
  });

  // The folder trail, and the search term when there is one — above everything in classic, as
  // part of the title of the Files region in the new looks.
  const header = (
    <div className={styles.header}>
      <div className={styles['header-left']}>
        <Breadcrumbs
          items={[
            { label: 'My Drive', onClick: folderPath.length > 0 ? () => navigateTo(-1) : undefined },
            ...folderPath.map((f, i) => ({
              label: f.name,
              onClick: i < folderPath.length - 1 ? () => navigateTo(i) : undefined,
            })),
          ]}
        />
        {searchTerm && (
          <span className={styles['search-chip']} data-testid="drive-search-chip">
            <Search size={12} aria-hidden="true" />
            <span className={styles['search-chip-label']}>{searchTerm}</span>
            <button
              type="button"
              className={styles['search-chip-clear']}
              onClick={clearSearch}
              aria-label={`Clear search filter ${searchTerm}`}
            >
              <X size={12} />
            </button>
          </span>
        )}
      </div>
    </div>
  );


  return (
    <FileRail actions={actions}>
    <div className={styles.page} data-own-regions={flow || undefined}>
      {!flow && header}

      {/* Quick access — hidden while showing search results */}
      {!searchTerm && (
        <QuickAccess
          entries={quickAccess.entries}
          loading={quickAccess.loading}
          onOpen={actions.openFile}
        />
      )}

      {/* Files — the same grid whether it is listing a folder or search hits */}
      <section className={`${styles.section} ${styles['section-files']}`} aria-labelledby="all-files-heading">
        {flow ? (
          <div className={styles['files-title']}>
            <h1 id="all-files-heading" className={styles['page-title']}>
              {searchTerm ? 'Search results' : folderPath.length > 0 ? folderPath[folderPath.length - 1].name : 'My Drive'}
            </h1>
            {(folderPath.length > 0 || searchTerm) && header}
          </div>
        ) : (
          <Heading level={2} size="sm" id="all-files-heading">
            {searchTerm ? 'Search results' : 'Files'}
          </Heading>
        )}
        <FileGrid
          items={searchTerm ? searchGridItems : gridItems}
          isLoading={searchTerm ? searchHits === null : isLoading}
          isError={searchTerm ? false : isError}
          emptyState={
            searchTerm ? (
              <EmptyState
                icon={SearchX}
                title="No matches"
                description={`Nothing in your files matched \u201c${searchTerm}\u201d.`}
                action={
                  <Button variant="secondary" size="sm" onClick={clearSearch}>
                    Clear search
                  </Button>
                }
              />
            ) : isError ? (
              <EmptyState
                title="Could not load files"
                description="There was an error loading your files. Please try again."
                action={<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Retry</Button>}
              />
            ) : (
              <EmptyState
                icon={Folder}
                title="No files yet"
                description="Upload files to get started. Your files will appear here."
                action={
                  <Button variant="primary" size="sm" icon={<Upload size={16} />} onClick={() => openUpload()}>
                    Upload your first file
                  </Button>
                }
              />
            )
          }
          {...(searchTerm
            // Search hits are not all Drive files, so the Drive-only affordances
            // (context menu, starring, bulk select, upload drop target) are off.
            ? { onItemClick: handleSearchItemClick }
            : actions.gridProps)}
          showFilter
          filter={filter}
          onFilterChange={setFilter}
          showSizeColumn={!searchTerm}
          viewMode={listing.view}
          onViewModeChange={listing.setView}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={listing.setSort}
          totalCount={
            searchTerm
              ? searchHits?.length
              : isLoading ? undefined : folders.length + files.length
          }
          footer={
            !searchTerm && hasNextPage ? (
              <div ref={setLoadMoreEl} className={fileActionStyles['load-more']} aria-live="polite">
                {isFetchingNextPage && <Text size="sm" color="muted">Loading more…</Text>}
              </div>
            ) : undefined
          }
        />
      </section>

      {/* Overlays */}
      {actions.overlays}
      {importOpen && (
        <LocalImportDialog
          open
          onClose={() => setImportOpen(false)}
          folderId={currentFolderId}
          folderName={
            (currentFolderId && folderPath.find((f) => f.id === currentFolderId)?.name) || (currentFolderId ? 'This folder' : 'My Drive')
          }
        />
      )}
      {newFolderDialogOpen && (
        <NameDialog
          title="New folder"
          label="Folder name"
          initialValue="New folder"
          submitLabel="Create"
          pending={createFolderMutation.isPending}
          onClose={() => setNewFolderDialogOpen(false)}
          onSubmit={(name) => createFolderMutation.mutate(name)}
        />
      )}
    </div>
    </FileRail>
  );
}
