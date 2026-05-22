'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal, ModalHeader, ModalBody, Button, Text, Spinner } from '@neutrino/ui';
import { Folder, ChevronRight, Home } from 'lucide-react';
import { filesystemApi, type Folder as FolderItem } from '@/lib/api';
import styles from './MoveFolderDialog.module.css';

interface Props {
  itemName: string;
  currentFolderId?: string | null;
  onMove: (targetFolderId: string | null) => void;
  onClose: () => void;
  isPending?: boolean;
}

interface BreadcrumbEntry {
  id: string | null;
  name: string;
}

export function MoveFolderDialog({ itemName, currentFolderId, onMove, onClose, isPending }: Props) {
  const [browseFolderId, setBrowseFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([{ id: null, name: 'My Drive' }]);

  const { data, isLoading } = useQuery({
    queryKey: ['move-folder-browse', browseFolderId],
    queryFn: () =>
      browseFolderId
        ? filesystemApi.getFolderContents(browseFolderId, { limit: 200, offset: 0, orderBy: 'name', direction: 'asc' })
        : filesystemApi.getRootContents({ limit: 200, offset: 0, orderBy: 'name', direction: 'asc' }),
  });

  const folders: FolderItem[] = data?.folders ?? [];

  function navigateInto(folder: FolderItem) {
    setBrowseFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function navigateTo(index: number) {
    const target = breadcrumbs[index];
    setBrowseFolderId(target.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  }

  const isCurrentLocation = browseFolderId === (currentFolderId ?? null);

  return (
    <Modal open onClose={onClose} size="sm">
      <ModalHeader title={`Move "${itemName}"`} onClose={onClose} />
      <ModalBody>
        <div className={styles.breadcrumbs}>
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.id ?? 'root'}>
              {i > 0 && <ChevronRight size={12} className={styles.chevron} />}
              <button
                type="button"
                className={[styles.crumb, i === breadcrumbs.length - 1 ? styles.crumbActive : ''].filter(Boolean).join(' ')}
                onClick={() => i < breadcrumbs.length - 1 && navigateTo(i)}
                disabled={i === breadcrumbs.length - 1}
              >
                {i === 0 && <Home size={12} />}
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className={styles.folderList}>
          {isLoading ? (
            <div className={styles.loading}><Spinner size="sm" /></div>
          ) : folders.length === 0 ? (
            <Text size="sm" color="muted" className={styles.empty}>No folders here</Text>
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={styles.folderRow}
                onClick={() => navigateInto(folder)}
              >
                <Folder size={16} className={styles.folderIcon} style={{ color: folder.color ?? 'var(--color-amber, #d97706)' }} />
                <Text size="sm" truncate>{folder.name}</Text>
                <ChevronRight size={14} className={styles.folderChevron} />
              </button>
            ))
          )}
        </div>

        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onMove(browseFolderId)}
            disabled={isPending || isCurrentLocation}
          >
            {isPending ? 'Moving…' : 'Move here'}
          </Button>
        </div>
      </ModalBody>
    </Modal>
  );
}
