import type { GridItem, SortDir, SortField } from '@neutrino/ui';
import type {
  FileItem,
  Folder as FolderItem,
  TeamFile,
  TeamFolder,
  TeamSharedFile,
  TrashFileItem,
  TrashFolderItem,
} from '@/lib/api';
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

/**
 * A team's own files and folders, mapped the same way as everybody else's.
 *
 * Team rows *are* Drive rows — `files`/`folders` scoped by `team_id` — so a team file should show
 * the icon, the size and the friendly date its owner's copy would have shown, and it does because
 * this is the same mapping. Two fields have no team answer and are deliberately left off rather
 * than faked: a star is a personal mark on a personal file, and the library listing carries no
 * thumbnail, so a team card falls back to the mimetype icon.
 */
export function teamFileToGridItem(file: TeamFile): GridItem {
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
  };
}

export function teamFolderToGridItem(folder: TeamFolder): GridItem {
  return {
    id: folder.id,
    name: folder.name,
    kind: 'folder',
    icon: Folder,
    iconColor: 'var(--color-amber, #d97706)',
    subtitle: 'Folder',
    typeText: 'Folder',
    sizeText: '—',
    modifiedText: formatDate(folder.updatedAt),
    updatedAt: folder.updatedAt,
  };
}

/**
 * A file somebody has *lent* to the team, which is not one of the team's own.
 *
 * The subtitle says whose it is and what the team may do with it, because that is the whole
 * difference and it is otherwise invisible: the row looks like a team file, and it is somebody's
 * personal file they can take back at any moment. The date is when it was lent — a share has no
 * other date the team is entitled to.
 */
export function teamSharedFileToGridItem(file: TeamSharedFile): GridItem {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : '—';
  return {
    id: file.fileId,
    name: file.name,
    kind: 'file',
    icon: getFileIcon(file.mimeType),
    iconColor: getIconColor(file.mimeType),
    subtitle: `${file.sharedByName} · ${file.role === 'editor' ? 'can edit' : 'can view'}`,
    mimeType: file.mimeType,
    typeText: ext,
    sizeText: formatFileSize(file.sizeBytes),
    modifiedText: formatDate(file.sharedAt),
    updatedAt: file.sharedAt,
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
