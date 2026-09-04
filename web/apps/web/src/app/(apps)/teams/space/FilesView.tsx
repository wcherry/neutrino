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
 */

import React, { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, File as FileIcon, Folder, FolderPlus, Trash2, Upload } from 'lucide-react';
import {
  AlertDialog,
  Button,
  EmptyState,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Text,
  TextInput,
  useToast,
} from '@neutrino/ui';
import {
  authApi,
  isMissingEncryptionKey,
  teamsApi,
  uploadDriveFile,
  type Team,
  type TeamFile,
  type TeamFolder,
} from '@/lib/api';
import { useUser } from '@neutrino/auth';
import { formatBytes } from '../../admin/bytes';
import { teamCan } from '../permissions';
import styles from './space.module.css';

const LOCKED_MESSAGE =
  'Your encryption key is locked, so the file could not be encrypted. Unlock it in Settings → Security and try again.';

export function FilesView({ team }: { team: Team }) {
  const qc = useQueryClient();
  const currentUser = useUser();
  const { success, error: toastError } = useToast();
  const fileInput = useRef<HTMLInputElement | null>(null);

  /** The path from the team root to the folder being shown. Empty means the root. */
  const [trail, setTrail] = useState<TeamFolder[]>([]);
  const folderId = trail.length > 0 ? trail[trail.length - 1].id : undefined;

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TeamFile | null>(null);

  const { data, isLoading } = useQuery({
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

  const canUpload = teamCan(team, 'uploadFile');
  const canDelete = teamCan(team, 'deleteFile');

  const folders = data?.folders ?? [];
  const files = data?.files ?? [];

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

      {isLoading ? (
        <div className={styles.loading}>
          <Spinner size="md" />
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <EmptyState
          icon={Folder}
          title={trail.length > 0 ? 'This folder is empty' : 'No files yet'}
          description="Files uploaded here belong to the team, not to whoever uploaded them."
        />
      ) : (
        <div className={styles.list}>
          {folders.map((folder) => (
            <div key={folder.id} className={styles.row}>
              <Folder size={16} />
              <button
                type="button"
                className={styles.rowButton}
                onClick={() => setTrail([...trail, folder])}
              >
                <span className={styles.rowTitle}>{folder.name}</span>
                <span className={styles.rowMeta}>Folder</span>
              </button>
            </div>
          ))}
          {files.map((file) => (
            <div key={file.id} className={styles.row}>
              <FileIcon size={16} />
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{file.name}</span>
                <span className={styles.rowMeta}>
                  {formatBytes(file.sizeBytes)} · added{' '}
                  {new Date(file.createdAt).toLocaleDateString()}
                </span>
              </div>
              {canDelete && (
                <div className={styles.rowActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${file.name}`}
                    onClick={() => setPendingDelete(file)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
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
