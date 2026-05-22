'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
  EmptyState,
} from '@neutrino/ui';
import { Folder as FolderIcon, FileText, ChevronRight, Search } from 'lucide-react';
import { filesystemApi, type FileItem, type Folder } from '@/lib/api';
import styles from './page.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriveFilePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (file: { id: string; name: string }) => void;
}

interface BreadcrumbEntry {
  id: string | null;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMimeType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return mimeType.replace('image/', '').toUpperCase();
  const map: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/zip': 'ZIP',
    'text/plain': 'TXT',
    'text/csv': 'CSV',
    'application/json': 'JSON',
  };
  return map[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? '';
}

// ── DriveFilePicker ───────────────────────────────────────────────────────────

export function DriveFilePicker({ open, onClose, onSelect }: DriveFilePickerProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbEntry[]>([
    { id: null, name: 'My Drive' },
  ]);
  const [filter, setFilter] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['drive-picker', currentFolderId],
    queryFn: () =>
      currentFolderId
        ? filesystemApi.getFolderContents(currentFolderId)
        : filesystemApi.getRootContents(),
    enabled: open,
  });

  const folders: Folder[] = data?.folders ?? [];
  const files: FileItem[] = data?.files ?? [];

  const filteredFolders = useMemo(() => {
    if (!filter.trim()) return folders;
    const lower = filter.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(lower));
  }, [folders, filter]);

  const filteredFiles = useMemo(() => {
    if (!filter.trim()) return files;
    const lower = filter.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(lower));
  }, [files, filter]);

  const isEmpty = !isLoading && !isError && filteredFolders.length === 0 && filteredFiles.length === 0;

  function handleFolderClick(folder: Folder) {
    setCurrentFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setFilter('');
  }

  function handleBreadcrumbClick(entry: BreadcrumbEntry, index: number) {
    if (index === breadcrumbs.length - 1) return; // already current
    setCurrentFolderId(entry.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
    setFilter('');
  }

  function handleFileClick(file: FileItem) {
    onSelect({ id: file.id, name: file.name });
    onClose();
  }

  function handleClose() {
    // Reset state when closing so picker is fresh next time it opens
    setCurrentFolderId(null);
    setBreadcrumbs([{ id: null, name: 'My Drive' }]);
    setFilter('');
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} size="md">
      <ModalHeader title="Browse Drive" onClose={handleClose} />
      <ModalBody>
        {/* Breadcrumb trail */}
        <nav className={styles.drivePickerBreadcrumb} aria-label="Folder path">
          {breadcrumbs.map((crumb, i) => {
            const isCurrent = i === breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id ?? '__root__'}>
                {i > 0 && (
                  <span className={styles.drivePickerBreadcrumbSep} aria-hidden="true">
                    <ChevronRight size={12} />
                  </span>
                )}
                {isCurrent ? (
                  <span className={styles.drivePickerBreadcrumbCurrent}>{crumb.name}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.drivePickerBreadcrumbBtn}
                    onClick={() => handleBreadcrumbClick(crumb, i)}
                  >
                    {crumb.name}
                  </button>
                )}
              </React.Fragment>
            );
          })}
        </nav>

        {/* Search / filter */}
        <div className={styles.drivePickerSearch}>
          <span className={styles.drivePickerSearchIcon}>
            <Search size={14} />
          </span>
          <input
            type="search"
            className={styles.drivePickerSearchInput}
            placeholder="Filter by name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter files and folders"
          />
        </div>

        {/* File / folder list */}
        <div className={styles.drivePickerList} role="listbox" aria-label="Drive contents">
          {isLoading && (
            <div className={styles.drivePickerLoading}>
              <Spinner size="md" />
            </div>
          )}

          {isError && !isLoading && (
            <EmptyState
              size="sm"
              title="Could not load Drive"
              description="Check your connection and try again."
            />
          )}

          {isEmpty && (
            <EmptyState
              size="sm"
              icon={filter.trim() ? undefined : FolderIcon}
              title={filter.trim() ? 'No matches' : 'This folder is empty'}
              description={filter.trim() ? 'Try a different search term.' : undefined}
            />
          )}

          {!isLoading &&
            !isError &&
            filteredFolders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className={styles.drivePickerItem}
                role="option"
                aria-selected={false}
                onClick={() => handleFolderClick(folder)}
              >
                <span className={styles.drivePickerItemIcon}>
                  <FolderIcon
                    size={16}
                    color={folder.color ?? 'var(--color-amber, #d97706)'}
                    fill={folder.color ?? 'var(--color-amber, #d97706)'}
                    fillOpacity={0.2}
                  />
                </span>
                <span className={styles.drivePickerItemName}>{folder.name}</span>
                <span className={styles.drivePickerItemMeta}>
                  <ChevronRight size={12} />
                </span>
              </button>
            ))}

          {!isLoading &&
            !isError &&
            filteredFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                className={styles.drivePickerItem}
                role="option"
                aria-selected={false}
                onClick={() => handleFileClick(file)}
              >
                <span className={styles.drivePickerItemIcon}>
                  <FileText size={16} color="var(--color-text-secondary, #6b7280)" />
                </span>
                <span className={styles.drivePickerItemName}>{file.name}</span>
                <span className={styles.drivePickerItemMeta}>
                  {formatMimeType(file.mimeType)}
                </span>
              </button>
            ))}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}
