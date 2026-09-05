'use client';

/**
 * The team file library (issue #185, phase 4).
 *
 * An upload here is two calls, and that is the design rather than a shortcut. The bytes go through
 * `uploadDriveFile` — the same path My Drive uses, so the file is encrypted on the device, gets its
 * thumbnail, and is charged to the uploader's quota — and `teamsApi.claimFile` then moves it into
 * the team. Threading a team id through the upload endpoint instead would have meant a second
 * upload path with its own encryption and quota handling, which is the parallel copy the issue's
 * success criteria rule out.
 *
 * The listing is `FileGrid`, the same component every Drive view renders, for the same reason the
 * upload is the same call: a team file **is** a Drive file — a row in `files` scoped by `team_id` —
 * and the hand-written list it used to have was a second, poorer answer to a question Drive had
 * already answered. What that buys is not cosmetic: the Large grid / Small grid / Detailed list
 * selector, the type-filter chips, the sort bar, right-click, and one mapping (`drive/gridItems`)
 * deciding what a file's icon, size and date look like everywhere.
 *
 * The chips filter **client-side** here, unlike My Drive, which sends its chip to the server as
 * `?type=`: the library endpoint takes no type parameter and returns the folder in one response, so
 * there is nothing to page and `FileGrid`'s own pass over the items is the whole answer.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ChevronRight, Folder, FolderPlus, Trash2, Upload, X } from 'lucide-react';
import {
  AlertDialog,
  Button,
  EmptyState,
  FileGrid,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Text,
  TextInput,
  useToast,
  type GridItem,
  type SortDir,
  type SortField,
} from '@neutrino/ui';
import {
  authApi,
  isMissingEncryptionKey,
  teamsApi,
  uploadDriveFile,
  type Team,
  type TeamFile,
  type TeamFolder,
  type TeamSharedFile,
} from '@/lib/api';
import { useUser } from '@neutrino/auth';
import { useFeatureFlags } from '@/providers/FeatureFlagsProvider';
import { canTransferToTeams } from '@/lib/featureFlags';
import {
  sortEntries,
  teamFileToGridItem,
  teamFolderToGridItem,
  teamSharedFileToGridItem,
} from '../../drive/gridItems';
import { routeForFile } from '../../drive/routeForFile';
import { formatBytes } from '../../admin/bytes';
import { roleCan, teamCan } from '../permissions';
import menuStyles from '../../drive/FileContextMenu.module.css';
import styles from './space.module.css';

const LOCKED_MESSAGE =
  'Your encryption key is locked, so the file could not be encrypted. Unlock it in Settings → Security and try again.';

interface ContextMenuState {
  id: string;
  name: string;
  /** Which listing the row came from — the two offer different actions. */
  source: 'library' | 'shared';
  x: number;
  y: number;
}

/**
 * The row menu, built the way `DocumentLibrary` builds its own: a handful of actions over the
 * shared context-menu stylesheet, rather than `FileContextMenu`, which is a `FileItem`'s menu and
 * offers eight things a team row cannot do (star, tags, personal move, copy link).
 */
function RowMenu({
  x,
  y,
  label,
  onClose,
  onAction,
}: {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  onAction: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={menuStyles.menu}
      style={{ left: Math.min(x, window.innerWidth - 200), top: Math.min(y, window.innerHeight - 120) }}
      role="menu"
      aria-label="File options"
    >
      <button
        type="button"
        className={[menuStyles.item, menuStyles.danger].join(' ')}
        role="menuitem"
        onClick={() => {
          onAction();
          onClose();
        }}
      >
        <span className={menuStyles.itemIcon}>
          {label === 'Stop sharing' ? <X size={14} /> : <Trash2 size={14} />}
        </span>
        {label}
      </button>
    </div>
  );
}

export function FilesView({ team }: { team: Team }) {
  const qc = useQueryClient();
  const router = useRouter();
  const currentUser = useUser();
  const { success, error: toastError } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);

  /** The path from the team root to the folder being shown. Empty means the root. */
  const [trail, setTrail] = useState<TeamFolder[]>([]);
  const folderId = trail.length > 0 ? trail[trail.length - 1].id : undefined;

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TeamFile | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // The library endpoint takes no sort parameters, so the order is decided here — as it is on
  // Recent, Starred and Shared with me, which are in the same position.
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['team-library', team.id, folderId ?? null],
    queryFn: () => teamsApi.listLibrary(team.id, folderId),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['team-library', team.id] });
    qc.invalidateQueries({ queryKey: ['team', team.id] });
  }, [qc, team.id]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // The same fallback UploadZone uses: `useUser()` can still be empty on a fresh page, and
      // `uploadDriveFile` refuses rather than falling back to a plaintext upload if the keypair
      // cannot be resolved at all.
      const userId =
        currentUser?.id ??
        (await authApi
          .getProfile()
          .then((u) => u.id)
          .catch(() => null));
      const uploaded = await uploadDriveFile(file, userId, {});
      return teamsApi.claimFile(team.id, uploaded.id, folderId);
    },
    onSuccess: () => {
      invalidate();
      success('File added to the team.');
    },
    onError: (err: unknown) => {
      toastError(
        isMissingEncryptionKey(err)
          ? LOCKED_MESSAGE
          : err instanceof Error
            ? err.message
            : 'Upload failed.'
      );
    },
  });

  const createFolder = useMutation({
    mutationFn: () => teamsApi.createLibraryFolder(team.id, folderName.trim(), folderId),
    onSuccess: () => {
      setFolderName('');
      setCreatingFolder(false);
      invalidate();
    },
    onError: () => toastError('Could not create the folder.'),
  });

  const trashFile = useMutation({
    mutationFn: (fileId: string) => teamsApi.trashLibraryFile(team.id, fileId),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
      success('Moved to trash.');
    },
    onError: () => toastError('Could not delete the file.'),
  });

  // Files members have lent to the team without giving them away (issue #185). A separate query and
  // a separate grid, deliberately: a lent file is not in the library, does not count against the
  // team's meter, and is still somebody's to take back — folding it into the list above would make
  // all three invisible.
  const transfersOn = canTransferToTeams(useFeatureFlags());
  const { data: sharedData } = useQuery({
    queryKey: ['team-shares', team.id],
    queryFn: () => teamsApi.listSharedFiles(team.id),
    enabled: transfersOn,
  });

  const unshare = useMutation({
    mutationFn: (fileId: string) => teamsApi.unshareFileFromTeam(team.id, fileId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-shares', team.id] });
      success('No longer shared with this team.');
    },
    onError: () => toastError('Could not remove that file.'),
  });

  const canUpload = teamCan(team, 'uploadFile');
  const canDelete = teamCan(team, 'deleteFile');
  // `roleCan` rather than `teamCan`: archiving a team pauses its own content, and must not lock
  // somebody's personal file inside it. The server takes the same view.
  const canManageShares = roleCan(team.userRole, 'managePermissions');

  const folders = useMemo(() => data?.folders ?? [], [data]);
  const files = useMemo(() => data?.files ?? [], [data]);
  const shared = useMemo(() => sharedData?.files ?? [], [sharedData]);

  // Folders first, as on My Drive; each group ordered by the current sort.
  const items: GridItem[] = useMemo(
    () => [
      ...sortEntries(folders, sortBy, sortDir).map(teamFolderToGridItem),
      ...sortEntries(files, sortBy, sortDir).map(teamFileToGridItem),
    ],
    [folders, files, sortBy, sortDir]
  );

  // A share has one date, `sharedAt`, and it stands in for both — so "newest" and "recently
  // modified" mean the same thing here rather than one of them meaning nothing.
  const sharedItems: GridItem[] = useMemo(
    () =>
      sortEntries(
        shared.map((f) => ({ ...f, createdAt: f.sharedAt, updatedAt: f.sharedAt })),
        sortBy,
        sortDir
      ).map(teamSharedFileToGridItem),
    [shared, sortBy, sortDir]
  );

  function openLibraryItem(item: GridItem) {
    if (item.kind === 'folder') {
      const folder = folders.find((f) => f.id === item.id);
      if (folder) setTrail([...trail, folder]);
      return;
    }
    const file = files.find((f) => f.id === item.id);
    // No preview fallback: `PreviewModal` takes a `FileItem`, which a team row is not, and a file
    // with no editor is reached from the team's Drive listing like any other.
    if (file) routeForFile(file, router, { onPreviewFallback: () => {} });
  }

  function openSharedItem(item: GridItem) {
    const file = shared.find((f) => f.fileId === item.id);
    if (file) {
      routeForFile({ id: file.fileId, name: file.name, mimeType: file.mimeType }, router, {
        onPreviewFallback: () => {},
      });
    }
  }

  function openMenu(source: 'library' | 'shared', item: GridItem, e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ id: item.id, name: item.name, source, x: e.clientX, y: e.clientY });
  }

  const menuFile: TeamFile | undefined =
    contextMenu?.source === 'library' ? files.find((f) => f.id === contextMenu.id) : undefined;
  const menuShare: TeamSharedFile | undefined =
    contextMenu?.source === 'shared' ? shared.find((f) => f.fileId === contextMenu.id) : undefined;
  const menuIsActionable =
    (menuFile != null && canDelete) ||
    (menuShare != null && (canManageShares || menuShare.sharedBy === currentUser?.id));

  return (
    <>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <Heading level={1} size="lg">
            Files
          </Heading>
          <div className={styles.storageBar}>
            <span>
              {formatBytes(data?.storageUsedBytes ?? team.storageUsedBytes)} used
              {team.storageLimitBytes ? ` of ${formatBytes(team.storageLimitBytes)}` : ''}
            </span>
          </div>
        </div>
        {canUpload && (
          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setCreatingFolder(true)}>
              <FolderPlus size={16} /> New folder
            </Button>
            <Button onClick={() => fileInput.current?.click()} loading={upload.isPending}>
              <Upload size={16} /> Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {trail.length > 0 && (
        <div className={styles.breadcrumbs}>
          <button type="button" className={styles.crumb} onClick={() => setTrail([])}>
            Files
          </button>
          {trail.map((folder, i) => (
            <React.Fragment key={folder.id}>
              <ChevronRight size={12} />
              <button
                type="button"
                className={styles.crumb}
                onClick={() => setTrail(trail.slice(0, i + 1))}
              >
                {folder.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      <FileGrid
        items={items}
        isLoading={isLoading}
        isError={isError}
        showFilter
        onItemClick={openLibraryItem}
        onItemMenuOpen={canDelete ? (item, e) => openMenu('library', item, e) : undefined}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => {
          setSortBy(field);
          setSortDir(dir);
        }}
        totalCount={isLoading ? undefined : folders.length + files.length}
        emptyState={
          isError ? (
            <EmptyState
              title="Could not load the team's files"
              description="There was an error loading this team's library."
            />
          ) : (
            <EmptyState
              icon={Folder}
              title={trail.length > 0 ? 'This folder is empty' : 'No files yet'}
              description="Files uploaded here belong to the team, not to whoever uploaded them."
            />
          )
        }
      />

      {/* Only shown when there is something in it. An empty "Shared with this team" heading on
          every team's Files page would advertise a feature rather than report a fact. */}
      {shared.length > 0 && (
        <>
          <div className={styles.sharedHeading}>
            <Heading level={2} size="sm">
              Shared with this team
            </Heading>
            <Text size="sm" color="secondary">
              These stay in their owner&apos;s Drive. The owner can stop sharing them at any time.
            </Text>
          </div>
          <FileGrid
            items={sharedItems}
            onItemClick={openSharedItem}
            onItemMenuOpen={(item, e) => openMenu('shared', item, e)}
            showSizeColumn
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(field, dir) => {
              setSortBy(field);
              setSortDir(dir);
            }}
            totalCount={sharedItems.length}
          />
        </>
      )}

      {contextMenu && menuIsActionable && (
        <RowMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={menuShare ? 'Stop sharing' : 'Move to trash'}
          onClose={() => setContextMenu(null)}
          onAction={() => {
            if (menuShare) unshare.mutate(menuShare.fileId);
            else if (menuFile) setPendingDelete(menuFile);
          }}
        />
      )}

      <Modal
        open={creatingFolder}
        onClose={() => setCreatingFolder(false)}
        title="New folder"
        size="sm"
      >
        <ModalHeader title="New folder" onClose={() => setCreatingFolder(false)} />
        <ModalBody>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="folder-name">
              Name
            </label>
            <TextInput
              id="folder-name"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              autoFocus
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setCreatingFolder(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => createFolder.mutate()}
            disabled={!folderName.trim() || createFolder.isPending}
            loading={createFolder.isPending}
          >
            Create
          </Button>
        </ModalFooter>
      </Modal>

      <AlertDialog
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        variant="warning"
        title={pendingDelete ? `Move "${pendingDelete.name}" to trash?` : ''}
        description={
          <Text size="sm" color="secondary">
            It goes to the same trash as any other file and can be restored from there.
          </Text>
        }
        confirmLabel="Move to trash"
        loading={trashFile.isPending}
        onConfirm={() => pendingDelete && trashFile.mutate(pendingDelete.id)}
      />
    </>
  );
}
