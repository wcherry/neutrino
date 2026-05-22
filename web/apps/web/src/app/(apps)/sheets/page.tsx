'use client';
// Intentionally a full client component: the "New Spreadsheet" action button and the
// FileGrid emptyState action share the same createSheet mutation, making the server
// shell (one Heading tag) too trivial to justify the split.

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Heading, useToast } from '@neutrino/ui';
import { FilePlus, Table2 } from 'lucide-react';
import {
  sheetsApi,
  storageApi,
  filesystemApi,
  downloadAndDecryptFile,
  driveReadContent,
  driveCreateEncryptedVersion,
  encryptionApi,
  type SheetMetaResponse,
  type FileItem,
} from '@/lib/api';
import { useUser } from '@neutrino/auth';
import { initSodium, generateFileKey, encryptFileKey, loadKeyPair } from '@neutrino/e2e-crypto';
import { FileGrid, type GridItem, type SortField, type SortDir } from '@neutrino/ui';
import { FileContextMenu } from '../drive/FileContextMenu';
import { FileInfoPanel } from '../drive/FileInfoPanel';
import { ShareDialog } from '../drive/ShareDialog';
import { MoveFolderDialog } from '../drive/MoveFolderDialog';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import styles from './page.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function sheetToGridItem(sheet: SheetMetaResponse): GridItem {
  return {
    id: sheet.id,
    name: sheet.title,
    kind: 'doc',
    icon: Table2,
    iconColor: 'var(--color-green, #16a34a)',
    subtitle: formatDate(sheet.updatedAt),
    typeText: 'Sheet',
    modifiedText: formatDate(sheet.updatedAt),
  };
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
  id: string;
  title: string;
  x: number;
  y: number;
}

export default function SheetsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currentUser = useUser();
  const [sortBy, setSortBy] = React.useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [contextFile, setContextFile] = React.useState<FileItem | null>(null);
  const [shareFile, setShareFile] = React.useState<FileItem | null>(null);
  const [infoFile, setInfoFile] = React.useState<FileItem | null>(null);
  const [moveFileId, setMoveFileId] = React.useState<string | null>(null);
  const [moveFileName, setMoveFileName] = React.useState('');
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['sheets'],
    queryFn: () => sheetsApi.listSheets(),
    staleTime: 0,
  });

  const createSheet = useMutation({
    mutationFn: async () => {
      const sheet = await sheetsApi.createSheet({ title: 'Untitled spreadsheet' });
      const userId = currentUser?.id;
      if (userId) {
        try {
          await initSodium();
          const kp = loadKeyPair(userId);
          if (kp) {
            const dek = generateFileKey();
            const encryptedFileKey = encryptFileKey(dek, kp.publicKey);
            const initialContent = await driveReadContent(sheet.contentUrl);
            await driveCreateEncryptedVersion(sheet.id, initialContent, 'sheet.json', dek);
            await encryptionApi.setFileKey(sheet.id, { encryptedFileKey });
          }
        } catch {
          // Non-fatal: editor falls back to plaintext if E2EE setup fails
        }
      }
      return sheet;
    },
    onSuccess: (sheet) => router.push(`/sheets/editor?id=${sheet.id}`),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      sheetsApi.saveSheet(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Spreadsheet renamed');
      setRenaming(null);
    },
    onError: () => toast.error('Failed to rename spreadsheet'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => storageApi.deleteFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Spreadsheet deleted');
    },
    onError: () => toast.error('Failed to delete spreadsheet'),
  });

  const starMutation = useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      filesystemApi.updateFile(id, { isStarred }),
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      setContextFile(file);
      toast.success(file.isStarred ? 'Added to starred' : 'Removed from starred');
    },
    onError: () => toast.error('Failed to update starred status'),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetFolderId }: { id: string; targetFolderId: string | null }) =>
      filesystemApi.updateFile(id, { folderId: targetFolderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      toast.success('Spreadsheet moved');
      setMoveFileId(null);
    },
    onError: () => toast.error('Failed to move spreadsheet'),
  });

  async function handleMenuOpen(item: GridItem, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right, window.innerWidth - 200);
    const y = Math.min(rect.bottom, window.innerHeight - 300);
    setContextMenu({ id: item.id, title: item.name, x, y });
    setContextFile(null);
    try {
      const file = await storageApi.getFileMetadata(item.id);
      setContextFile(file);
    } catch {
      // Context menu still works without file metadata
    }
  }

  async function handleDownload(id: string, title: string) {
    try {
      if (contextFile?.encryptedMetadata) {
        const userId = currentUser?.id;
        if (!userId) { toast.error('Failed to download spreadsheet'); return; }
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) { toast.error('Encryption keys not found'); return; }
        const plaintext = await downloadAndDecryptFile(id, kp.publicKey, kp.secretKey);
        if (!plaintext) { toast.error('Failed to decrypt spreadsheet'); return; }
        triggerBlobDownload(new Blob([plaintext.slice(0)]), `${title}.json`);
      } else {
        const blob = await storageApi.downloadFile(id);
        triggerBlobDownload(blob, `${title}.json`);
      }
    } catch {
      toast.error('Failed to download spreadsheet');
    }
  }

  function handleCopyLink(id: string) {
    const url = `${window.location.origin}/sheets/editor?id=${id}`;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied to clipboard'),
      () => toast.error('Failed to copy link'),
    );
  }

  function handleRenameSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!renaming) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === renaming.title) { setRenaming(null); return; }
    renameMutation.mutate({ id: renaming.id, title: trimmed });
  }

  function closeContextMenu() {
    setContextMenu(null);
    setContextFile(null);
  }

  const sheets = data?.sheets ?? [];
  const gridItems: GridItem[] = sheets.map(sheetToGridItem);

  const menuFile: FileItem | null = contextFile ?? (contextMenu
    ? {
        id: contextMenu.id,
        name: contextMenu.title,
        sizeBytes: 0,
        mimeType: 'application/x-neutrino-sheet',
        folderId: null,
        isStarred: false,
        createdAt: '',
        updatedAt: '',
        coverThumbnail: null,
        coverThumbnailMimeType: null,
      }
    : null);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Spreadsheets</Heading>
        <Button onClick={() => createSheet.mutate()} disabled={createSheet.isPending} icon={<FilePlus size={16} />}>
          New Spreadsheet
        </Button>
      </div>

      <FileGrid
        items={gridItems}
        isLoading={isLoading}
        isError={isError}
        emptyState={
          <EmptyState
            icon={FilePlus}
            title="No spreadsheets yet"
            description="Create a new spreadsheet to get started."
            action={
              <Button onClick={() => createSheet.mutate()} disabled={createSheet.isPending}>
                New Spreadsheet
              </Button>
            }
          />
        }
        onItemClick={(item) => {
          router.push(`/sheets/editor?id=${item.id}`);
        }}
        onItemMenuOpen={handleMenuOpen}
        showFilter={false}
        showSizeColumn={false}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : sheets.length}
      />

      {previewId && (
        <DocumentPreviewModal
          id={previewId}
          kind="sheet"
          onClose={() => setPreviewId(null)}
        />
      )}

      {contextMenu && menuFile && (
        <FileContextMenu
          file={menuFile}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          onPreview={() => {
            setPreviewId(contextMenu.id);
            closeContextMenu();
          }}
          onInfo={() => {
            if (menuFile) setInfoFile(menuFile);
            closeContextMenu();
          }}
          onShare={() => {
            if (menuFile) setShareFile(menuFile);
            closeContextMenu();
          }}
          onRename={() => {
            setRenameValue(contextMenu.title);
            setRenaming({ id: contextMenu.id, title: contextMenu.title });
            closeContextMenu();
          }}
          onStarToggle={() => {
            starMutation.mutate({ id: contextMenu.id, isStarred: !menuFile.isStarred });
            closeContextMenu();
          }}
          onDownload={() => {
            handleDownload(contextMenu.id, contextMenu.title);
            closeContextMenu();
          }}
          onDelete={() => {
            deleteMutation.mutate(contextMenu.id);
            closeContextMenu();
          }}
          onCopyLink={() => {
            handleCopyLink(contextMenu.id);
            closeContextMenu();
          }}
          onMove={() => {
            setMoveFileId(contextMenu.id);
            setMoveFileName(contextMenu.title);
            closeContextMenu();
          }}
        />
      )}

      {shareFile && (
        <ShareDialog resource={shareFile} resourceType="file" onClose={() => setShareFile(null)} />
      )}

      {moveFileId && (
        <MoveFolderDialog
          itemName={moveFileName}
          currentFolderId={contextFile?.folderId}
          onMove={(targetFolderId) => moveMutation.mutate({ id: moveFileId, targetFolderId })}
          onClose={() => setMoveFileId(null)}
          isPending={moveMutation.isPending}
        />
      )}

      {infoFile && <FileInfoPanel file={infoFile} onClose={() => setInfoFile(null)} />}

      {renaming && (
        <div className={styles['rename-overlay']} onClick={() => setRenaming(null)}>
          <div
            className={styles['rename-dialog']}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
          >
            <Heading level={2} size="sm" id="rename-title">Rename spreadsheet</Heading>
            <form className={styles['rename-form']} onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className={styles['rename-input']}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="New spreadsheet name"
              />
              <div className={styles['rename-actions']}>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={!renameValue.trim() || renameMutation.isPending}>Rename</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
