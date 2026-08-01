import type { GridItem } from '@neutrino/ui';
import type { FileItem, Folder as FolderItem } from '@/lib/api';
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
    isStarred: folder.isStarred,
  };
}
