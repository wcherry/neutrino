'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heading,
  Text,
  Button,
  EmptyState,
  FileGrid,
  useToast,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  type GridItem,
  type SortDir,
  type SortField,
} from '@neutrino/ui';
import { Trash2 } from 'lucide-react';
import { filesystemApi } from '@/lib/api';
import { sortEntries, trashFileToGridItem, trashFolderToGridItem } from '../gridItems';
import { TrashContextMenu } from './TrashContextMenu';
import styles from './page.module.css';

interface PendingDelete {
  id: string;
  name: string;
  kind: 'file' | 'folder';
}

interface ContextMenuState {
  item: GridItem;
  x: number;
  y: number;
}

export default function TrashPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['trash'],
    queryFn: () => filesystemApi.listTrash(),
  });

  const { mutate: emptyTrash, isPending: isEmptyingTrash } = useMutation({
    mutationFn: () => filesystemApi.emptyTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      toast.success('Trash emptied');
    },
    onError: () => toast.error('Failed to empty trash'),
  });

  const restoreFileMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.restoreFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      toast.success('File restored');
    },
    onError: () => toast.error('Failed to restore file'),
  });

  const restoreFolderMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.restoreFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['contents'] });
      toast.success('Folder restored');
    },
    onError: () => toast.error('Failed to restore folder'),
  });

  const deleteFilePermanentlyMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.deleteFilePermanently(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setPendingDelete(null);
      toast.success('File permanently deleted');
    },
    onError: () => toast.error('Failed to delete file'),
  });

  const deleteFolderPermanentlyMutation = useMutation({
    mutationFn: (id: string) => filesystemApi.deleteFolderPermanently(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      setPendingDelete(null);
      toast.success('Folder permanently deleted');
    },
    onError: () => toast.error('Failed to delete folder'),
  });

  function confirmPermanentDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'file') {
      deleteFilePermanentlyMutation.mutate(pendingDelete.id);
    } else {
      deleteFolderPermanentlyMutation.mutate(pendingDelete.id);
    }
  }

  const isConfirmPending =
    deleteFilePermanentlyMutation.isPending || deleteFolderPermanentlyMutation.isPending;

  const files = useMemo(() => data?.files ?? [], [data]);
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const total = files.length + folders.length;
  const isEmpty = !isLoading && total === 0;

  // Trash rows carry `deletedAt` rather than `updatedAt`; the grid's "Modified"
  // sort therefore orders by when the item was deleted.
  const items: GridItem[] = useMemo(
    () => [
      ...sortEntries(
        folders.map((f) => ({ ...f, updatedAt: f.deletedAt })),
        sortBy,
        sortDir,
      ).map(trashFolderToGridItem),
      ...sortEntries(
        files.map((f) => ({ ...f, updatedAt: f.deletedAt })),
        sortBy,
        sortDir,
      ).map(trashFileToGridItem),
    ],
    [files, folders, sortBy, sortDir],
  );

  function handleMenuOpen(item: GridItem, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenu({ item, x: rect.right, y: rect.bottom });
  }

  function restore(item: GridItem) {
    if (item.kind === 'folder') restoreFolderMutation.mutate(item.id);
    else restoreFileMutation.mutate(item.id);
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Trash</Heading>
        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => emptyTrash()}
            disabled={isEmptyingTrash}
          >
            Empty trash
          </Button>
        )}
      </div>

      <FileGrid
        items={items}
        isLoading={isLoading}
        isError={isError}
        // Trashed items cannot be opened — restore them first.
        onItemClick={() => {}}
        onItemMenuOpen={handleMenuOpen}
        defaultViewMode="list"
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : total}
        emptyState={
          isError ? (
            <EmptyState
              title="Could not load trash"
              description="There was an error loading your deleted files."
            />
          ) : (
            <EmptyState
              icon={Trash2}
              title="Trash is empty"
              description="Files you delete will appear here for 30 days before being permanently removed."
            />
          )
        }
      />

      {contextMenu && (
        <TrashContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onRestore={() => restore(contextMenu.item)}
          onDeleteForever={() =>
            setPendingDelete({
              id: contextMenu.item.id,
              name: contextMenu.item.name,
              kind: contextMenu.item.kind === 'folder' ? 'folder' : 'file',
            })
          }
        />
      )}

      {pendingDelete && (
        <Modal open onClose={() => setPendingDelete(null)} size="sm">
          <ModalHeader title="Delete permanently?" onClose={() => setPendingDelete(null)} />
          <ModalBody>
            <Text size="sm">
              <strong>{pendingDelete.name}</strong> will be permanently deleted and cannot be recovered.
            </Text>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" size="sm" onClick={() => setPendingDelete(null)} disabled={isConfirmPending}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmPermanentDelete} disabled={isConfirmPending}>
              Delete forever
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
