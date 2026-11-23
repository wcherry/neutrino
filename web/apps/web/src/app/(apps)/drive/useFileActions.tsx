'use client';

/**
 * Everything a listing of Drive files can do to the files in it — one copy,
 * shared by My Drive and every app library (`FileLibrary`).
 *
 * The grid is `FileGrid` and the cards are `fileToGridItem`/`folderToGridItem`
 * everywhere already; this is the third piece. Before it, My Drive held the
 * full set (menu, star, share, move, tags, download, bulk select, drag-in
 * upload) inline, and each app library re-implemented a four-item subset of
 * the menu with its own rename dialog — so the same spreadsheet offered
 * different actions depending on which page it was listed on.
 *
 * What stays with the page is what is particular to it: My Drive's folder
 * navigation, New folder, import and search; a library's create button.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import {
  Button,
  Heading,
  PanelRail,
  useToast,
  type FileGridProps,
  type GridItem,
  type RailPanel,
  type RailSide,
  type RailSpec,
} from '@neutrino/ui';
import { useDismiss } from '@neutrino/commands';
import { loadKeyPair, initSodium } from '@neutrino/e2e-crypto';
import {
  storageApi,
  filesystemApi,
  teamsApi,
  downloadAndDecryptFile,
  useUser,
  type FileItem,
  type Folder as FolderItem,
} from '@/lib/api';
import { describeKeyHandover, handFileKeyToTeam } from '@/lib/teamTransfer';
import { invalidateDriveListings } from '@/lib/driveLiveUpdates';
import { useRailState } from '@/lib/panelLayouts';
import type { DocumentKind } from '@/components/DocumentPreviewModal';
import { FileContextMenu } from './FileContextMenu';
import { FolderContextMenu } from './FolderContextMenu';
import { routeForFile, previewKindForMime } from './routeForFile';
import { appLinkKindForMime, copyAppLink } from '../open/copyAppLink';
import styles from './fileActions.module.css';

export { styles as fileActionStyles };

// Every dialog, preview and panel here opens on a click, never on first paint, so each is loaded
// when it is first needed rather than with the listing — every app library carries this hook, and
// pulled in statically these put all six of their routes over budget (`route-budgets.json`).
const UploadZone = dynamic(() => import('./UploadZone').then((m) => m.UploadZone), { ssr: false });
const PreviewModal = dynamic(() => import('./PreviewModal').then((m) => m.PreviewModal), { ssr: false });
const FileInfoPanel = dynamic(() => import('./FileInfoPanel').then((m) => m.FileInfoPanel), { ssr: false });
const ShareDialog = dynamic(() => import('./ShareDialog').then((m) => m.ShareDialog), { ssr: false });
const MoveFolderDialog = dynamic(() => import('./MoveFolderDialog').then((m) => m.MoveFolderDialog), { ssr: false });
const DocumentPreviewModal = dynamic(
  () => import('@/components/DocumentPreviewModal').then((m) => m.DocumentPreviewModal),
  { ssr: false },
);

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

// ── Name dialog ──────────────────────────────────────────────────────────────

export interface NameDialogProps {
  title: string;
  /** Accessible name of the text field. */
  label: string;
  initialValue: string;
  submitLabel: string;
  pending?: boolean;
  /** Called with the trimmed value when it is non-empty and differs from `initialValue`. */
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/** One small modal for every "type a name" step: rename a file, rename a folder, name a new folder. */
export function NameDialog({ title, label, initialValue, submitLabel, pending, onSubmit, onClose }: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = React.useId();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed === initialValue) { onClose(); return; }
    onSubmit(trimmed);
  }

  return (
    <div className={styles['name-overlay']} onClick={onClose}>
      <div
        className={styles['name-dialog']}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <Heading level={2} size="sm" id={titleId}>{title}</Heading>
        <form className={styles['name-form']} onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className={styles['name-input']}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={label}
          />
          <div className={styles['name-actions']}>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={!value.trim() || pending}>{submitLabel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── The hook ─────────────────────────────────────────────────────────────────

/** File info is a tab in a right rail, the same layout on every listing (lib/panelLayouts.ts). */
const FILE_SIDES: RailSide[] = ['right'];
const FILE_PANEL_SPEC: RailSpec = { sides: FILE_SIDES, panels: [{ id: 'info', side: 'right' }] };

export interface UseFileActionsOptions {
  /** The listing's files, as loaded — the menu and the bulk actions act on these objects. */
  files: FileItem[];
  /** The listing's folders, if it has any. */
  folders?: FolderItem[];
  /** What clicking a folder does; without it a folder click does nothing. */
  onOpenFolder?: (folder: FolderItem) => void;
  /** Where a file dragged onto the grid is uploaded; `null` is the drive's root. */
  uploadFolderId?: string | null;
  /** The folder the bulk Move dialog starts in. */
  currentFolderId?: string | null;
}

type GridActionProps = Pick<
  FileGridProps,
  | 'onItemClick'
  | 'onItemMenuOpen'
  | 'onToggleStar'
  | 'selectedIds'
  | 'onItemSelect'
  | 'onDragEnter'
  | 'onDragOver'
  | 'onDragLeave'
  | 'onDrop'
  | 'isDraggingOver'
>;

export interface FileActions {
  /** Spread onto `FileGrid`. */
  gridProps: GridActionProps;
  /** Open a file the way a click on its card does — an editor, or the preview. */
  openFile: (file: FileItem) => void;
  /** Show a file in the preview modal without opening its editor (a deep-linked `?preview=`). */
  showPreview: (file: FileItem) => void;
  /** Open the upload dialog, optionally with files already chosen. */
  openUpload: (files?: File[]) => void;
  /** Every dialog, menu and toolbar the actions open; render once, anywhere in the page. */
  overlays: React.ReactNode;
  /** For `FileRail`. */
  rail: {
    panels: RailPanel[];
    layout: ReturnType<typeof useRailState>['layout'];
    onLayoutChange: (next: ReturnType<typeof useRailState>['layout']) => void;
  };
}

export function useFileActions({
  files,
  folders = [],
  onOpenFolder,
  uploadFolderId = null,
  currentFolderId = null,
}: UseFileActionsOptions): FileActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const router = useRouter();
  const currentUser = useUser();

  const fileMap = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  // A change to one file can move it in or out of any listing — a star adds it
  // to Starred, a move takes it out of a folder — so every write refreshes the
  // listings rather than guessing which ones it touched. Only those on screen refetch.
  const refreshListings = useCallback(() => invalidateDriveListings(queryClient), [queryClient]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[] | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [docPreview, setDocPreview] = useState<{ id: string; kind: DocumentKind } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ file: FileItem; x: number; y: number } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ folder: FolderItem; x: number; y: number } | null>(null);
  // `focusTags` opens the panel with the tag picker already expanded, so
  // "Manage tags" lands on the tag UI in one click instead of two.
  const [infoFile, setInfoFile] = useState<{ file: FileItem; focusTags: boolean } | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [shareFolder, setShareFolder] = useState<FolderItem | null>(null);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);
  const [movingFolder, setMovingFolder] = useState<FolderItem | null>(null);
  const [renaming, setRenaming] = useState<FileItem | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMovePending, setBulkMovePending] = useState(false);

  useDismiss(() => setSelectedIds(new Set()), selectedIds.size > 0);

  // File info follows the file it shows.
  const panels = useRailState('drive', FILE_PANEL_SPEC);
  useEffect(() => {
    if (infoFile) panels.open('info');
    else panels.close('info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoFile?.file.id, infoFile?.focusTags]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; folderId?: string | null; isStarred?: boolean } }) =>
      filesystemApi.updateFile(id, body),
    onSuccess: refreshListings,
  });

  const updateFolderMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name?: string; isStarred?: boolean } }) =>
      filesystemApi.updateFolder(id, body),
    onSuccess: refreshListings,
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetFolderId }: { id: string; targetFolderId: string | null }) =>
      filesystemApi.updateFile(id, { folderId: targetFolderId }),
    onSuccess: () => {
      refreshListings();
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
    mutationFn: async ({ file, teamId, folderId }: { file: FileItem; teamId: string; folderId: string | null }) => {
      const moved = await teamsApi.moveFileIntoTeam(teamId, file.id, folderId ?? undefined);
      const keys = await handFileKeyToTeam(teamId, file.id, currentUser?.id);
      const team = eligibleTeams.find((t) => t.id === teamId);
      return { file, moved, keys, teamName: team?.name ?? 'the team' };
    },
    onSuccess: ({ file, moved, keys, teamName }) => {
      refreshListings();
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
      refreshListings();
      toast.success('File deleted');
    },
    onError: () => toast.error('Failed to delete file'),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.deleteFolder(id),
    onSuccess: () => {
      refreshListings();
      toast.success('Folder deleted');
    },
    onError: () => toast.error('Failed to delete folder'),
  });

  const moveFolderMutation = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      filesystemApi.updateFolder(id, { parentId: parentId ?? undefined }),
    onSuccess: () => {
      refreshListings();
      toast.success('Folder moved');
      setMovingFolder(null);
    },
    onError: () => toast.error('Failed to move folder'),
  });

  // ── Single-item actions ───────────────────────────────────────────────────

  const openFile = useCallback((file: FileItem) => {
    routeForFile(file, router, { onPreviewFallback: () => setPreviewFile(file) });
  }, [router]);

  const handleStar = useCallback((file: FileItem) => {
    updateMutation.mutate(
      { id: file.id, body: { isStarred: !file.isStarred } },
      {
        onSuccess: () => toast.success(file.isStarred ? 'Removed from starred' : 'Added to starred'),
        onError: () => toast.error('Failed to update file'),
      }
    );
  }, [updateMutation, toast]);

  const handleFolderStar = useCallback((folder: FolderItem) => {
    updateFolderMutation.mutate(
      { id: folder.id, body: { isStarred: !folder.isStarred } },
      {
        onSuccess: () => toast.success(folder.isStarred ? 'Removed from starred' : 'Added to starred'),
        onError: () => toast.error('Failed to update folder'),
      }
    );
  }, [updateFolderMutation, toast]);

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
    copyAppLink(appLinkKindForMime(file.mimeType), file.id, file.name).then(
      () => toast.success('Link copied to clipboard'),
      () => toast.error('Failed to copy link')
    );
  }

  /**
   * The menu's Preview. Docs, sheets, slides, notes, diagrams and drawings each
   * have a read-only preview renderer (distinct from "open to edit"); images use
   * `PreviewModal`. Everything else goes through `routeForFile`, which is built
   * for click-to-open and would otherwise navigate straight into the editor for
   * those same native types (issue #68).
   */
  function previewFileAction(file: FileItem) {
    const kind = previewKindForMime(file.mimeType);
    if (kind === 'image') setPreviewFile(file);
    else if (kind) setDocPreview({ id: file.id, kind });
    else openFile(file);
  }

  // ── Grid handlers ─────────────────────────────────────────────────────────

  const onItemClick = useCallback((item: GridItem) => {
    if (item.kind === 'folder') {
      const folder = folderMap.get(item.id);
      if (folder) onOpenFolder?.(folder);
      return;
    }
    const file = fileMap.get(item.id);
    if (file) openFile(file);
  }, [fileMap, folderMap, onOpenFolder, openFile]);

  const onItemMenuOpen = useCallback((item: GridItem, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right, window.innerWidth - 200);
    const y = Math.min(rect.bottom, window.innerHeight - 300);
    if (item.kind === 'folder') {
      const folder = folderMap.get(item.id);
      if (folder) setFolderContextMenu({ folder, x, y });
      return;
    }
    const file = fileMap.get(item.id);
    if (file) setContextMenu({ file, x, y });
  }, [fileMap, folderMap]);

  const onToggleStar = useCallback((item: GridItem) => {
    if (item.kind === 'folder') {
      const folder = folderMap.get(item.id);
      if (folder) handleFolderStar(folder);
    } else {
      const file = fileMap.get(item.id);
      if (file) handleStar(file);
    }
  }, [fileMap, folderMap, handleFolderStar, handleStar]);

  const onItemSelect = useCallback((item: GridItem) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  // ── Drag-in upload ────────────────────────────────────────────────────────

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only react to file drags, not text/link drags.
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) {
      e.preventDefault();
      setIsDraggingOver(true);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDragLeave = useCallback(() => {
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) setIsDraggingOver(false);
  }, []);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) {
      setDroppedFiles(dropped);
      setUploadOpen(true);
    }
  }, []);

  const openUpload = useCallback((initial?: File[]) => {
    setDroppedFiles(initial ?? null);
    setUploadOpen(true);
  }, []);

  // ── Bulk actions ──────────────────────────────────────────────────────────

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
      refreshListings();
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
    for (const id of Array.from(selectedIds)) {
      const file = fileMap.get(id);
      if (file) await handleDownload(file);
    }
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    try {
      await Promise.all(
        ids.map((id) => {
          if (fileMap.has(id)) return storageApi.deleteFile(id);
          if (folderMap.has(id)) return filesystemApi.deleteFolder(id);
          return Promise.resolve();
        })
      );
      refreshListings();
      toast.success(`${ids.length} ${ids.length === 1 ? 'item' : 'items'} deleted`);
      setSelectedIds(new Set());
    } catch {
      toast.error('Failed to delete some items');
    }
  }

  // ── Rendered pieces ───────────────────────────────────────────────────────

  const railPanels: RailPanel[] = [
    {
      id: 'info',
      title: 'File info',
      icon: <Info size={14} />,
      side: 'right',
      content: infoFile ? (
        <FileInfoPanel
          key={`${infoFile.file.id}:${infoFile.focusTags}`}
          file={infoFile.file}
          focusTags={infoFile.focusTags}
        />
      ) : (
        <p className={styles.panelEmpty}>Choose Info on a file to see its details and tags here.</p>
      ),
    },
  ];

  const onLayoutChange: FileActions['rail']['onLayoutChange'] = (next) => {
    panels.setLayout(next);
    // Collapsing file info clears it, as closing the panel did.
    if (infoFile && !next.floating.info && next.rails.right?.expanded !== 'info') setInfoFile(null);
  };

  const overlays = (
    <>
      {uploadOpen && (
        <UploadZone
          onClose={() => { setUploadOpen(false); setDroppedFiles(null); }}
          folderId={uploadFolderId}
          initialFiles={droppedFiles ?? undefined}
        />
      )}
      {previewFile && <PreviewModal file={previewFile} siblings={files} onClose={() => setPreviewFile(null)} />}
      {docPreview && (
        <DocumentPreviewModal id={docPreview.id} kind={docPreview.kind} onClose={() => setDocPreview(null)} />
      )}

      {contextMenu && (
        <FileContextMenu
          file={contextMenu.file}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPreview={() => { previewFileAction(contextMenu.file); setContextMenu(null); }}
          onInfo={() => { setInfoFile({ file: contextMenu.file, focusTags: false }); setContextMenu(null); }}
          onManageTags={() => { setInfoFile({ file: contextMenu.file, focusTags: true }); setContextMenu(null); }}
          onShare={() => { setShareFile(contextMenu.file); setContextMenu(null); }}
          onRename={() => { setRenaming(contextMenu.file); setContextMenu(null); }}
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
          onRename={() => { setRenamingFolder(folderContextMenu.folder); setFolderContextMenu(null); }}
          onStarToggle={() => { handleFolderStar(folderContextMenu.folder); setFolderContextMenu(null); }}
          onMove={() => { setMovingFolder(folderContextMenu.folder); setFolderContextMenu(null); }}
          onDelete={() => { deleteFolderMutation.mutate(folderContextMenu.folder.id); setFolderContextMenu(null); }}
          onShare={() => { setShareFolder(folderContextMenu.folder); setFolderContextMenu(null); }}
        />
      )}

      {renaming && (
        <NameDialog
          title="Rename file"
          label="New file name"
          initialValue={renaming.name}
          submitLabel="Rename"
          pending={updateMutation.isPending}
          onClose={() => setRenaming(null)}
          onSubmit={(name) =>
            updateMutation.mutate(
              { id: renaming.id, body: { name } },
              {
                onSuccess: () => { toast.success('File renamed'); setRenaming(null); },
                onError: () => toast.error('Failed to rename file'),
              }
            )
          }
        />
      )}

      {renamingFolder && (
        <NameDialog
          title="Rename folder"
          label="New folder name"
          initialValue={renamingFolder.name}
          submitLabel="Rename"
          pending={updateFolderMutation.isPending}
          onClose={() => setRenamingFolder(null)}
          onSubmit={(name) =>
            updateFolderMutation.mutate(
              { id: renamingFolder.id, body: { name } },
              {
                onSuccess: () => { toast.success('Folder renamed'); setRenamingFolder(null); },
                onError: () => toast.error('Failed to rename folder'),
              }
            )
          }
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

      {shareFile && <ShareDialog resource={shareFile} resourceType="file" onClose={() => setShareFile(null)} />}
      {shareFolder && <ShareDialog resource={shareFolder} resourceType="folder" onClose={() => setShareFolder(null)} />}

      {moveFile && (
        <MoveFolderDialog
          itemName={moveFile.name}
          currentFolderId={moveFile.folderId}
          teams={eligibleTeams}
          onMove={(targetFolderId) => moveMutation.mutate({ id: moveFile.id, targetFolderId })}
          onMoveIntoTeam={(teamId, folderId) => moveIntoTeamMutation.mutate({ file: moveFile, teamId, folderId })}
          onClose={() => setMoveFile(null)}
          isPending={moveMutation.isPending || moveIntoTeamMutation.isPending}
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
    </>
  );

  return {
    gridProps: {
      onItemClick,
      onItemMenuOpen,
      onToggleStar,
      selectedIds,
      onItemSelect,
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
      isDraggingOver,
    },
    openFile,
    showPreview: setPreviewFile,
    openUpload,
    overlays,
    rail: { panels: railPanels, layout: panels.layout, onLayoutChange },
  };
}

/** The listing inside its file-info rail, scrolling within it. */
export function FileRail({ actions, children }: { actions: FileActions; children: React.ReactNode }) {
  return (
    <PanelRail
      panels={actions.rail.panels}
      sides={FILE_SIDES}
      layout={actions.rail.layout}
      onLayoutChange={actions.rail.onLayoutChange}
      className={styles.panelHost}
    >
      <div className={styles.scroller}>{children}</div>
    </PanelRail>
  );
}
