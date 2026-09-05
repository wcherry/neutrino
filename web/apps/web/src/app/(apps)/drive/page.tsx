'use client';
// Intentionally a full client component: folder-navigation state (currentFolderId,
// folderPath) is shared by the breadcrumbs, heading, FileGrid, and every modal/overlay.
// There is no static server shell of non-trivial size to extract.

import React, { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heading,
  Text,
  Button,
  Card,
  Breadcrumbs,
  EmptyState,
  Skeleton,
  useToast,
} from '@neutrino/ui';
import {
  Folder,
  Clock,
  Upload,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import { storageApi, filesystemApi, teamsApi, downloadAndDecryptFile, useUser, type FileItem, type Folder as FolderItem, type DriveFileType } from '@/lib/api';
import { describeKeyHandover, handFileKeyToTeam } from '@/lib/teamTransfer';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import { loadKeyPair, initSodium } from '@neutrino/e2e-crypto';
import { useRouter, useSearchParams } from 'next/navigation';
import { useClientSearch, type SearchHit } from '@/hooks/useClientSearch';
import { useSearchIndexUpdates } from '@/hooks/useSearchIndexUpdates';
import { DRIVE_SEARCH_PARAM, DRIVE_PREVIEW_PARAM } from './searchParams';
import { UploadZone } from './UploadZone';
import { PreviewModal } from './PreviewModal';
import { FileContextMenu } from './FileContextMenu';
import { FolderContextMenu } from './FolderContextMenu';
import { FileInfoPanel } from './FileInfoPanel';
import { ShareDialog } from './ShareDialog';
import { MoveFolderDialog } from './MoveFolderDialog';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { canTransferToTeams } from '@/lib/featureFlags';
import { FileGrid, type GridItem, type SortField, type SortDir, type FilterType } from '@neutrino/ui';
import { DocumentPreviewModal, type DocumentKind } from '@/components/DocumentPreviewModal';
import { routeForFile, previewKindForMime } from './routeForFile';
import {
  fileToGridItem,
  folderToGridItem,
  formatDate,
  formatFileSize,
} from './gridItems';
import styles from './page.module.css';

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

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

interface ContextMenuState {
  file: FileItem;
  x: number;
  y: number;
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
  const searchParams = useSearchParams();
  const searchTerm = (searchParams.get(DRIVE_SEARCH_PARAM) ?? '').trim();

  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filter, setFilter] = useState<FilterType>('all');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // Track drag depth to handle dragLeave correctly across child elements.
  const dragDepthRef = useRef(0);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // `focusTags` opens the panel with the tag picker already expanded, so
  // "Manage tags" lands on the tag UI in one click instead of two.
  const [infoFile, setInfoFile] = useState<{ file: FileItem; focusTags: boolean } | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  // Both team flags, `teamSpaces` first — see `canTransferToTeams`. With either off the Move
  // dialog is offered no teams and lists My Drive alone, rather than showing destinations whose
  // every action 404s.
  const teamTransfersOn = canTransferToTeams(useFeatureFlags());
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);
  const [docPreview, setDocPreview] = useState<{ id: string; kind: DocumentKind } | null>(null);
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ folder: FolderItem; x: number; y: number } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [movingFolder, setMovingFolder] = useState<FolderItem | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<Array<{ id: string; name: string }>>([]);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMovePending, setBulkMovePending] = useState(false);

  useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

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
      .then((file) => { if (!cancelled) setPreviewFile(file); })
      .catch(() => { if (!cancelled) toast.error('That file could not be opened'); });
    return () => { cancelled = true; };
    // `toast` is deliberately not a dependency: it is recreated on every render, and re-running
    // this would refetch the file each time anything on the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewParam]);

  useEffect(() => {
    function onNewFolder() { setNewFolderName('New folder'); setNewFolderDialogOpen(true); }
    function onUpload() { setUploadOpen(true); }
    window.addEventListener('drive:new-folder', onNewFolder);
    window.addEventListener('drive:upload', onUpload);
    return () => {
      window.removeEventListener('drive:new-folder', onNewFolder);
      window.removeEventListener('drive:upload', onUpload);
    };
  }, []);

  useEffect(() => {
    if (selectedIds.size === 0) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSelectedIds(new Set());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedIds.size]);

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

  const { data: starredData } = useQuery({
    queryKey: ['starred'],
    queryFn: () => filesystemApi.getStarred(5),
  });

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
    queryKey: ['contents', currentFolderId, currentUser?.id, { orderBy: sortBy, direction: sortDir, type: fileTypeParam(filter) }],
    queryFn: ({ pageParam }) =>
      filesystemApi.getFolderContents(currentFolderId ?? currentUser!.id, {
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
    enabled: !!currentFolderId || !!currentUser,
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
  // The sentinel sits after the last item inside the grid, so it works in the
  // detailed list (which scrolls itself) as well as the card views (where the
  // page scrolls). Held in state rather than a ref so the observer is attached
  // as soon as the node mounts.
  const [loadMoreEl, setLoadMoreEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!loadMoreEl || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) fetchNextPage(); },
      { rootMargin: '400px' }
    );
    observer.observe(loadMoreEl);
    return () => observer.disconnect();
  }, [loadMoreEl, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Build lookup maps for context menu callbacks (need original objects)
  const fileMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const gridItems: GridItem[] = useMemo(
    () => [
      ...folders.map(folderToGridItem),
      ...files.map(fileToGridItem),
    ],
    [folders, files]
  );

  const openFolder = useCallback((folder: FolderItem) => {
    setCurrentFolderId(folder.id);
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }, []);

  function navigateTo(index: number) {
    if (index === -1) {
      setCurrentFolderId(null);
      setFolderPath([]);
    } else {
      const target = folderPath[index];
      setCurrentFolderId(target.id);
      setFolderPath((prev) => prev.slice(0, index + 1));
    }
  }

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => filesystemApi.createFolder({ name, parentId: currentFolderId ?? undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
    },
    onError: () => toast.error('Failed to create folder'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; folderId?: string | null; isStarred?: boolean } }) =>
      filesystemApi.updateFile(id, body),
    onSuccess: (_, { body }) => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      if (body.isStarred !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['starred'] });
      }
    },
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; isStarred?: boolean } }) =>
      filesystemApi.updateFolder(id, body),
    onSuccess: (_, { body }) => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      if (body.isStarred !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['starred'] });
      }
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetFolderId }: { id: string; targetFolderId: string | null }) =>
      filesystemApi.updateFile(id, { folderId: targetFolderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success('File moved');
      setMoveFile(null);
    },
    onError: () => toast.error('Failed to move file'),
  });

  // Teams the caller may add content to. A Viewer's teams are listed nowhere: the server refuses
  // the move with a 403, and a destination that fails is worse than a shorter list.
  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(),
    enabled: teamTransfersOn,
  });
  const eligibleTeams = useMemo(
    () =>
      (teamsData?.teams ?? []).filter(
        (t) => !t.archived && ['owner', 'admin', 'editor', 'contributor'].includes(t.userRole)
      ),
    [teamsData]
  );

  /**
   * Move a file out of My Drive and into a team's library, then hand the members its key.
   *
   * Two calls, in this order: `POST /encryption/files/{id}/share` refuses a recipient with no
   * access yet, so the reseal has to follow the move. Nothing in the handover is fatal — see
   * `lib/teamTransfer.ts` — and what could not be sealed is named in the toast rather than left to
   * be discovered as a file the team can see and cannot open.
   */
  const moveIntoTeamMutation = useMutation({
    mutationFn: async ({
      file,
      teamId,
      folderId,
    }: {
      file: FileItem;
      teamId: string;
      folderId: string | null;
    }) => {
      const moved = await teamsApi.moveFileIntoTeam(teamId, file.id, folderId ?? undefined);
      const keys = await handFileKeyToTeam(teamId, file.id, currentUser?.id);
      const team = eligibleTeams.find((t) => t.id === teamId);
      return { file, moved, keys, teamName: team?.name ?? 'the team' };
    },
    onSuccess: ({ file, moved, keys, teamName }) => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      queryClient.invalidateQueries({ queryKey: ['team-library'] });
      queryClient.invalidateQueries({ queryKey: ['team-shares'] });
      setMoveFile(null);

      const lost =
        moved.sharesNoLongerApplied > 0
          ? ` ${moved.sharesNoLongerApplied} existing ${
              moved.sharesNoLongerApplied === 1 ? 'share' : 'shares'
            } no longer apply.`
          : '';
      const headline = `"${file.name}" now belongs to ${teamName}.${lost}`;
      const keyNote = describeKeyHandover(keys);
      if (keyNote) toast.error(`${headline} ${keyNote}`);
      else toast.success(headline);
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Failed to move the file into the team'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => storageApi.deleteFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success('File deleted');
    },
    onError: () => toast.error('Failed to delete file'),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.deleteFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success('Folder deleted');
    },
    onError: () => toast.error('Failed to delete folder'),
  });

  const moveFolderMutation = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      filesystemApi.updateFolder(id, { parentId: parentId ?? undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      toast.success('Folder moved');
      setMovingFolder(null);
    },
    onError: () => toast.error('Failed to move folder'),
  });

  const handleGridItemClick = useCallback((item: GridItem) => {
    if (item.kind === 'folder') {
      const folder = folderMap.get(item.id);
      if (folder) openFolder(folder);
      return;
    }
    const file = fileMap.get(item.id);
    if (!file) return;
    routeForFile(file, router, {
      onPreviewFallback: () => setPreviewFile(file),
    });
  }, [fileMap, folderMap, openFolder, router]);

  const handleGridItemMenuOpen = useCallback((item: GridItem, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right, window.innerWidth - 200);
    const y = Math.min(rect.bottom, window.innerHeight - 300);
    if (item.kind === 'folder') {
      const folder = folderMap.get(item.id);
      if (folder) setFolderContextMenu({ folder, x, y });
      return;
    }
    const file = fileMap.get(item.id);
    if (!file) return;
    setContextMenu({ file, x, y });
  }, [fileMap, folderMap]);

  const handleStar = useCallback((file: FileItem) => {
    updateMutation.mutate(
      { id: file.id, body: { isStarred: !file.isStarred } },
      {
        onSuccess: () => toast.success(file.isStarred ? 'Removed from starred' : 'Added to starred'),
        onError: () => toast.error('Failed to update file'),
      }
    );
  }, [updateMutation, toast]);

  const handleToggleStar = useCallback((item: GridItem) => {
    if (item.kind === 'folder') {
      const folder = folderMap.get(item.id);
      if (!folder) return;
      updateFolderMutation.mutate(
        { id: folder.id, body: { isStarred: !folder.isStarred } },
        {
          onSuccess: () => toast.success(folder.isStarred ? 'Removed from starred' : 'Added to starred'),
          onError: () => toast.error('Failed to update folder'),
        }
      );
    } else {
      const file = fileMap.get(item.id);
      if (file) handleStar(file);
    }
  }, [fileMap, folderMap, updateFolderMutation, toast, handleStar]);

  const handleItemSelect = useCallback((item: GridItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  async function handleBulkMove(targetFolderId: string | null) {
    setBulkMovePending(true);
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(
        ids.map((id) => {
          if (fileMap.has(id)) return filesystemApi.updateFile(id, { folderId: targetFolderId });
          if (folderMap.has(id)) return filesystemApi.updateFolder(id, { parentId: targetFolderId ?? undefined });
          return Promise.resolve();
        })
      );
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success(`${ids.length} ${ids.length === 1 ? 'item' : 'items'} moved`);
      setSelectedIds(new Set());
      setBulkMoveOpen(false);
    } catch {
      toast.error('Failed to move some items');
    } finally {
      setBulkMovePending(false);
    }
  }

  async function handleBulkDownload() {
    const ids = Array.from(selectedIds).filter((id) => fileMap.has(id));
    for (const id of ids) {
      const file = fileMap.get(id)!;
      await handleDownload(file);
    }
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    try {
      await Promise.all(
        ids.map((id) => {
          if (fileMap.has(id)) return storageApi.deleteFile(id);
          if (folderMap.has(id)) return filesystemApi.deleteFolder(id);
          return Promise.resolve();
        })
      );
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      queryClient.invalidateQueries({ queryKey: ['starred'] });
      toast.success(`${count} ${count === 1 ? 'item' : 'items'} deleted`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Failed to delete some items');
    }
  }

  async function handleDownload(file: FileItem) {
    try {
      if (file.encryptedMetadata) {
        const userId = currentUser?.id;
        if (!userId) { toast.error('Failed to download file'); return; }
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) { toast.error('Encryption keys not found'); return; }
        const plaintext = await downloadAndDecryptFile(file.id, userId);
        if (!plaintext) { toast.error('Failed to decrypt file'); return; }
        triggerBlobDownload(new Blob([plaintext.slice(0)]), file.name);
      } else {
        const blob = await storageApi.downloadFile(file.id);
        triggerBlobDownload(blob, file.name);
      }
    } catch {
      toast.error('Failed to download file');
    }
  }

  function handleCopyLink(file: FileItem) {
    const url = storageApi.getFileDownloadUrl(file.id);
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied to clipboard'),
      () => toast.error('Failed to copy link')
    );
  }

  function openRename(file: FileItem) {
    setRenameValue(file.name);
    setRenaming(file);
  }

  function handleFolderRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renamingFolder) return;
    const trimmed = renameFolderValue.trim();
    if (!trimmed || trimmed === renamingFolder.name) { setRenamingFolder(null); return; }
    updateFolderMutation.mutate(
      { id: renamingFolder.id, body: { name: trimmed } },
      {
        onSuccess: () => { toast.success('Folder renamed'); setRenamingFolder(null); },
        onError: () => toast.error('Failed to rename folder'),
      }
    );
  }

  function handleNewFolderSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    createFolderMutation.mutate(trimmed, {
      onSuccess: () => setNewFolderDialogOpen(false),
    });
  }

  function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renaming.name) { setRenaming(null); return; }
    updateMutation.mutate(
      { id: renaming.id, body: { name: trimmed } },
      {
        onSuccess: () => { toast.success('File renamed'); setRenaming(null); },
        onError: () => toast.error('Failed to rename file'),
      }
    );
  }

  // ── Area-wide drag-and-drop ──────────────────────────────────────────────────
  const handleAreaDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only react to file drags, not text/link drags.
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) {
      e.preventDefault();
      setIsDraggingOver(true);
    }
  }, []);

  const handleAreaDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleAreaDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleAreaDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setDroppedFiles(files);
      setUploadOpen(true);
    }
  }, []);

  return (
    <div className={styles.page}>
      {/* Page header */}
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

      {/* Quick access — hidden while showing search results */}
      {!searchTerm && (
      <section className={styles.section} aria-labelledby="quick-access-heading">
        <div className={styles['section-header']}>
          <Heading level={2} size="sm" id="quick-access-heading">Quick access</Heading>
          <Text as="span" size="xs" color="muted">
            <Clock size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
            Recently starred
          </Text>
        </div>
        <div className={styles['quick-grid']}>
          {!starredData
            ? Array.from({ length: 4 }, (_, i) => (
                <div key={i} className={styles['quick-card-skeleton']}>
                  <Skeleton shape="rect" width={32} height={32} />
                  <div style={{ flex: 1 }}>
                    <Skeleton shape="text" width="80%" height="0.875rem" />
                    <div style={{ marginTop: '4px' }}><Skeleton shape="text" width="50%" height="0.75rem" /></div>
                  </div>
                </div>
              ))
            : (() => {
                const starredFiles = starredData.files.map((file) => ({
                  key: file.id,
                  icon: getFileIcon(file.mimeType),
                  iconColor: getIconColor(file.mimeType),
                  name: file.name,
                  date: file.updatedAt,
                  coverThumbnail: file.coverThumbnail,
                  coverThumbnailMimeType: file.coverThumbnailMimeType,
                  onClick: () => {
                    routeForFile(file, router, {
                                      onPreviewFallback: () => setPreviewFile(file),
                    });
                  },
                }));
                const starredFolders = starredData.folders.map((folder) => ({
                  key: folder.id,
                  icon: Folder,
                  iconColor: folder.color ?? 'var(--color-amber, #d97706)',
                  name: folder.name,
                  date: folder.updatedAt,
                  coverThumbnail: null as string | null,
                  coverThumbnailMimeType: null as string | null,
                  onClick: () => openFolder(folder),
                }));
                const items = [...starredFiles, ...starredFolders];
                if (items.length === 0) {
                  return (
                    <Text size="sm" color="muted">
                      Star files and folders to see them here.
                    </Text>
                  );
                }
                return items.map((item) => {
                  const IconComponent = item.icon;
                  return (
                    <Card key={item.key} hoverable padding="sm" className={styles['quick-card']} role="button" tabIndex={0} aria-label={`Open ${item.name}`} onClick={item.onClick}>
                      <div className={styles['quick-card-inner']}>
                        <div className={styles['file-icon-sm']} style={!item.coverThumbnail ? { color: item.iconColor } : undefined}>
                          {item.coverThumbnail && item.coverThumbnailMimeType
                            ? <img src={`data:${item.coverThumbnailMimeType};base64,${item.coverThumbnail}`} alt="" className={styles['file-icon-sm-thumb']} loading="lazy" />
                            : <IconComponent size={20} strokeWidth={1.5} />
                          }
                        </div>
                        <div className={styles['quick-card-info']}>
                          <Text size="sm" weight="medium" truncate>{item.name}</Text>
                          <Text size="xs" color="muted">{formatDate(item.date)}</Text>
                        </div>
                      </div>
                    </Card>
                  );
                });
              })()}
        </div>
      </section>
      )}

      {/* Files — the same grid whether it is listing a folder or search hits */}
      <section className={`${styles.section} ${styles['section-files']}`} aria-labelledby="all-files-heading">
        <Heading level={2} size="sm" id="all-files-heading">
          {searchTerm ? 'Search results' : 'Files'}
        </Heading>
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
                  <Button variant="primary" size="sm" icon={<Upload size={16} />} onClick={() => setUploadOpen(true)}>
                    Upload your first file
                  </Button>
                }
              />
            )
          }
          onItemClick={searchTerm ? handleSearchItemClick : handleGridItemClick}
          {...(searchTerm
            // Search hits are not all Drive files, so the Drive-only affordances
            // (context menu, starring, bulk select, upload drop target) are off.
            ? {}
            : {
                onItemMenuOpen: handleGridItemMenuOpen,
                onToggleStar: handleToggleStar,
                selectedIds,
                onItemSelect: handleItemSelect,
                onDragEnter: handleAreaDragEnter,
                onDragOver: handleAreaDragOver,
                onDragLeave: handleAreaDragLeave,
                onDrop: handleAreaDrop,
                isDraggingOver,
              })}
          showFilter
          filter={filter}
          onFilterChange={setFilter}
          showSizeColumn={!searchTerm}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
          totalCount={
            searchTerm
              ? searchHits?.length
              : isLoading ? undefined : folders.length + files.length
          }
          footer={
            !searchTerm && hasNextPage ? (
              <div ref={setLoadMoreEl} className={styles['load-more']} aria-live="polite">
                {isFetchingNextPage && <Text size="sm" color="muted">Loading more…</Text>}
              </div>
            ) : undefined
          }
        />
      </section>

      {/* Overlays */}
      {uploadOpen && (
        <UploadZone
          onClose={() => { setUploadOpen(false); setDroppedFiles(null); }}
          folderId={currentFolderId}
          initialFiles={droppedFiles ?? undefined}
        />
      )}
      {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}
      {docPreview && (
        <DocumentPreviewModal id={docPreview.id} kind={docPreview.kind} onClose={() => setDocPreview(null)} />
      )}

      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPreview={(() => {
            const f = contextMenu.file;
            // Docs/sheets/slides/notes/diagrams/drawings each have a
            // lightweight read-only preview renderer (distinct from "open to
            // edit"); images use the generic PreviewModal directly. Everything
            // else (raw Office files when the office-editing flag is on, and
            // the generic fallback) is delegated to routeForFile, which is
            // built for click-to-open and would otherwise navigate straight
            // into the editor for these same native mimetypes (issue #68).
            const kind = previewKindForMime(f.mimeType);
            if (kind === 'image')
              return () => { setPreviewFile(f); setContextMenu(null); };
            if (kind)
              return () => { setDocPreview({ id: f.id, kind }); setContextMenu(null); };
            return () => {
              routeForFile(f, router, {
                          onPreviewFallback: () => setPreviewFile(f),
              });
              setContextMenu(null);
            };
          })()}
          onInfo={() => { setInfoFile({ file: contextMenu.file, focusTags: false }); setContextMenu(null); }}
          onManageTags={() => { setInfoFile({ file: contextMenu.file, focusTags: true }); setContextMenu(null); }}
          onShare={() => { setShareFile(contextMenu.file); setContextMenu(null); }}
          onRename={() => { openRename(contextMenu.file); setContextMenu(null); }}
          onStarToggle={() => { handleStar(contextMenu.file); setContextMenu(null); }}
          onDownload={() => { handleDownload(contextMenu.file); setContextMenu(null); }}
          onDelete={() => { deleteMutation.mutate(contextMenu.file.id); setContextMenu(null); }}
          onCopyLink={() => { handleCopyLink(contextMenu.file); setContextMenu(null); }}
          onMove={() => { setMoveFile(contextMenu.file); setContextMenu(null); }}
        />
      )}

      {folderContextMenu && (
        <FolderContextMenu
          folder={folderContextMenu.folder}
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          onClose={() => setFolderContextMenu(null)}
          onRename={() => { setRenameFolderValue(folderContextMenu.folder.name); setRenamingFolder(folderContextMenu.folder); setFolderContextMenu(null); }}
          onStarToggle={() => {
            const folder = folderContextMenu.folder;
            updateFolderMutation.mutate(
              { id: folder.id, body: { isStarred: !folder.isStarred } },
              {
                onSuccess: () => toast.success(folder.isStarred ? 'Removed from starred' : 'Added to starred'),
                onError: () => toast.error('Failed to update folder'),
              }
            );
            setFolderContextMenu(null);
          }}
          onMove={() => { setMovingFolder(folderContextMenu.folder); setFolderContextMenu(null); }}
          onDelete={() => { deleteFolderMutation.mutate(folderContextMenu.folder.id); setFolderContextMenu(null); }}
        />
      )}

      {movingFolder && (
        <MoveFolderDialog
          itemName={movingFolder.name}
          currentFolderId={movingFolder.parentId}
          onMove={(targetFolderId) => moveFolderMutation.mutate({ id: movingFolder.id, parentId: targetFolderId })}
          onClose={() => setMovingFolder(null)}
          isPending={moveFolderMutation.isPending}
        />
      )}

      {renamingFolder && (
        <div className={styles['rename-overlay']} onClick={() => setRenamingFolder(null)}>
          <div className={styles['rename-dialog']} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rename-folder-title">
            <Heading level={2} size="sm" id="rename-folder-title">Rename folder</Heading>
            <form className={styles['rename-form']} onSubmit={handleFolderRenameSubmit}>
              <input
                className={styles['rename-input']}
                type="text"
                value={renameFolderValue}
                onChange={(e) => setRenameFolderValue(e.target.value)}
                aria-label="New folder name"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <div className={styles['rename-actions']}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenamingFolder(null)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={!renameFolderValue.trim()}>Rename</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {shareFile && (
        <ShareDialog resource={shareFile} resourceType="file" onClose={() => setShareFile(null)} />
      )}

      {moveFile && (
        <MoveFolderDialog
          itemName={moveFile.name}
          currentFolderId={moveFile.folderId}
          teams={eligibleTeams}
          onMove={(targetFolderId) => moveMutation.mutate({ id: moveFile.id, targetFolderId })}
          onMoveIntoTeam={(teamId, folderId) =>
            moveIntoTeamMutation.mutate({ file: moveFile, teamId, folderId })
          }
          onClose={() => setMoveFile(null)}
          isPending={moveMutation.isPending || moveIntoTeamMutation.isPending}
        />
      )}

      {infoFile && (
        <FileInfoPanel
          key={`${infoFile.file.id}:${infoFile.focusTags}`}
          file={infoFile.file}
          focusTags={infoFile.focusTags}
          onClose={() => setInfoFile(null)}
        />
      )}

      {bulkMoveOpen && (
        <MoveFolderDialog
          itemName={`${selectedIds.size} ${selectedIds.size === 1 ? 'item' : 'items'}`}
          currentFolderId={currentFolderId}
          onMove={handleBulkMove}
          onClose={() => setBulkMoveOpen(false)}
          isPending={bulkMovePending}
        />
      )}

      {selectedIds.size > 0 && (
        <div className={styles['bulk-toolbar']}>
          <span className={styles['bulk-count']}>{selectedIds.size} selected</span>
          <div className={styles['bulk-actions']}>
            <Button variant="secondary" size="sm" onClick={() => setBulkMoveOpen(true)}>Move to</Button>
            <Button variant="secondary" size="sm" onClick={handleBulkDownload}>Download</Button>
            <Button variant="secondary" size="sm" onClick={handleBulkDelete}>Delete</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Cancel</Button>
          </div>
        </div>
      )}

      {newFolderDialogOpen && (
        <div className={styles['rename-overlay']} onClick={() => setNewFolderDialogOpen(false)}>
          <div className={styles['rename-dialog']} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="new-folder-title">
            <Heading level={2} size="sm" id="new-folder-title">New folder</Heading>
            <form className={styles['rename-form']} onSubmit={handleNewFolderSubmit}>
              <input
                className={styles['rename-input']}
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                aria-label="Folder name"
                autoFocus
                onFocus={(e) => e.target.select()}
              />
              <div className={styles['rename-actions']}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setNewFolderDialogOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={!newFolderName.trim() || createFolderMutation.isPending}>Create</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {renaming && (
        <div className={styles['rename-overlay']} onClick={() => setRenaming(null)}>
          <div className={styles['rename-dialog']} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <Heading level={2} size="sm" id="rename-title">Rename file</Heading>
            <form className={styles['rename-form']} onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className={styles['rename-input']}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="New file name"
              />
              <div className={styles['rename-actions']}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={!renameValue.trim()}>Rename</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
