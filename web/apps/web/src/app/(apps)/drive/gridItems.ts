import type { GridItem, SortDir, SortField } from '@neutrino/ui';
import type { FileItem, Folder as FolderItem, TrashFileItem, TrashFolderItem } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import { Folder } from 'lucide-react';

/**
 * Shared Drive → `FileGrid` mapping. Lives here rather than in `page.tsx` so
 * every surface that lists Drive files (My Drive, tag pages) renders the same
 * subtitle, icon, star state, and thumbnail.
 */

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function fileToGridItem(file: FileItem): GridItem {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : '—';
  return {
    id: file.id,
    name: file.name,
    kind: 'file',
    icon: getFileIcon(file.mimeType),
    iconColor: getIconColor(file.mimeType),
    subtitle: formatFileSize(file.sizeBytes),
    mimeType: file.mimeType,
    typeText: ext,
    sizeText: formatFileSize(file.sizeBytes),
    modifiedText: formatDate(file.updatedAt),
    updatedAt: file.updatedAt,
    isStarred: file.isStarred,
    coverThumbnail: file.coverThumbnail,
    coverThumbnailMimeType: file.coverThumbnailMimeType,
  };
}

export function folderToGridItem(folder: FolderItem): GridItem {
  return {
    id: folder.id,
    name: folder.name,
    kind: 'folder',
    icon: Folder,
    iconColor: folder.color ?? 'var(--color-amber, #d97706)',
    subtitle: 'Folder',
    typeText: 'Folder',
    sizeText: '—',
    modifiedText: formatDate(folder.updatedAt),
    updatedAt: folder.updatedAt,
    isStarred: folder.isStarred,
  };
}

/**
 * Trash rows carry `deletedAt` instead of `updatedAt`, so the Modified column
 * — and the card's friendly date — show when the item was deleted, the only
 * date that matters in Trash. The subtitle says which date it is; the card
 * renders `updatedAt` beside it, so it carries no date of its own.
 */
export function trashFileToGridItem(file: TrashFileItem): GridItem {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : '—';
  return {
    id: file.id,
    name: file.name,
    kind: 'file',
    icon: getFileIcon(file.mimeType),
    iconColor: getIconColor(file.mimeType),
    subtitle: 'Deleted',
    mimeType: file.mimeType,
    typeText: ext,
    sizeText: formatFileSize(file.sizeBytes),
    modifiedText: formatDate(file.deletedAt),
    updatedAt: file.deletedAt,
  };
}

export function trashFolderToGridItem(folder: TrashFolderItem): GridItem {
  return {
    id: folder.id,
    name: folder.name,
    kind: 'folder',
    icon: Folder,
    iconColor: 'var(--color-amber, #d97706)',
    subtitle: 'Deleted',
    typeText: 'Folder',
    sizeText: '—',
    modifiedText: formatDate(folder.deletedAt),
    updatedAt: folder.deletedAt,
  };
}

export interface SortableEntry {
  name: string;
  sizeBytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Client-side ordering for the Drive views whose endpoints take no sort
 * parameters (Recent, Starred, Shared with me, Trash). My Drive sorts in the
 * query instead, since it pages through the whole folder. Dates are ISO-8601,
 * so a string compare is a chronological one; entries missing the field keep
 * their relative order.
 */
export function sortEntries<T extends SortableEntry>(
  entries: T[],
  field: SortField,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    switch (field) {
      case 'size':
        return sign * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0));
      case 'createdAt':
        return sign * (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      case 'updatedAt':
        return sign * (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '');
      default:
        return sign * a.name.localeCompare(b.name);
    }
  });
}
