'use client';
// Intentionally a full client component: the "New Document" action button and the
// FileGrid emptyState action share the same createDoc mutation, making the server
// shell (one Heading tag) too trivial to justify the split.

import React, { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Heading, useToast } from '@neutrino/ui';
import { FilePlus, FileText } from 'lucide-react';
import {
  docsApi,
  storageApi,
  filesystemApi,
  downloadAndDecryptFile,
  driveReadContent,
  driveCreateEncryptedVersion,
  encryptionApi,
  type DocMetaResponse,
  type FileItem,
} from '@/lib/api';
import { useUser } from '@neutrino/auth';
import { initSodium, generateFileKey, encryptFileKey, loadKeyPair } from '@neutrino/e2e-crypto';
import { FileGrid, type GridItem, type SortField, type SortDir } from '@neutrino/ui';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import { FileContextMenu } from '../drive/FileContextMenu';
import { FileInfoPanel } from '../drive/FileInfoPanel';
import { ShareDialog } from '../drive/ShareDialog';
import { MoveFolderDialog } from '../drive/MoveFolderDialog';
import styles from './page.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function docToGridItem(doc: DocMetaResponse): GridItem {
  return {
    id: doc.id,
    name: doc.title,
    kind: 'doc',
    icon: FileText,
    iconColor: 'var(--color-accent)',
    subtitle: formatDate(doc.updatedAt),
    typeText: 'Doc',
    modifiedText: formatDate(doc.updatedAt),
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

export default function DocsPage() {
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
    queryKey: ['docs'],
    queryFn: () => docsApi.listDocs(),
  });

  const createDoc = useMutation({
    mutationFn: async () => {
      const doc = await docsApi.createDoc({ title: 'Untitled document' });
      const userId = currentUser?.id;
      if (userId) {
        try {
          await initSodium();
          const kp = loadKeyPair(userId);
          if (kp) {
            const dek = generateFileKey();
            const encryptedFileKey = encryptFileKey(dek, kp.publicKey);
            const initialContent = await driveReadContent(doc.contentUrl);
            await driveCreateEncryptedVersion(doc.id, initialContent, 'doc.json', dek);
            await encryptionApi.setFileKey(doc.id, { encryptedFileKey });
          }
        } catch {
          // Non-fatal: editor falls back to plaintext if E2EE setup fails
        }
      }
      return doc;
    },
    onSuccess: (doc) => router.push(`/docs/editor?id=${doc.id}`),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      docsApi.saveDoc(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      toast.success('Document renamed');
      setRenaming(null);
    },
    onError: () => toast.error('Failed to rename document'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => storageApi.deleteFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      toast.success('Document deleted');
    },
    onError: () => toast.error('Failed to delete document'),
  });

  const starMutation = useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      filesystemApi.updateFile(id, { isStarred }),
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      setContextFile(file);
      toast.success(file.isStarred ? 'Added to starred' : 'Removed from starred');
    },
    onError: () => toast.error('Failed to update starred status'),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetFolderId }: { id: string; targetFolderId: string | null }) =>
      filesystemApi.updateFile(id, { folderId: targetFolderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      toast.success('Document moved');
      setMoveFileId(null);
    },
    onError: () => toast.error('Failed to move document'),
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
        if (!userId) { toast.error('Failed to download document'); return; }
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) { toast.error('Encryption keys not found'); return; }
        const plaintext = await downloadAndDecryptFile(id, kp.publicKey, kp.secretKey);
        if (!plaintext) { toast.error('Failed to decrypt document'); return; }
        triggerBlobDownload(new Blob([plaintext.slice(0)]), `${title}.json`);
      } else {
        const blob = await storageApi.downloadFile(id);
        triggerBlobDownload(blob, `${title}.json`);
      }
    } catch {
      toast.error('Failed to download document');
    }
  }

  function handleCopyLink(id: string) {
    const url = `${window.location.origin}/docs/editor?id=${id}`;
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

  const docs = data?.docs ?? [];
  const gridItems: GridItem[] = docs.map(docToGridItem);

  const menuFile: FileItem | null = contextFile ?? (contextMenu
    ? {
        id: contextMenu.id,
        name: contextMenu.title,
        sizeBytes: 0,
        mimeType: 'application/x-neutrino-doc',
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
        <Heading level={1} size="xl">Documents</Heading>
        <Button onClick={() => createDoc.mutate()} disabled={createDoc.isPending} icon={<FilePlus size={16} />}>
          New Document
        </Button>
      </div>

      <FileGrid
        items={gridItems}
        isLoading={isLoading}
        isError={isError}
        emptyState={
          <EmptyState
            icon={FilePlus}
            title="No documents yet"
            description="Create a new document to get started."
            action={
              <Button onClick={() => createDoc.mutate()} disabled={createDoc.isPending}>
                New Document
              </Button>
            }
          />
        }
        onItemClick={(item) => {
          router.push(`/docs/editor?id=${item.id}`);
        }}
        onItemMenuOpen={handleMenuOpen}
        showFilter={false}
        showSizeColumn={false}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : docs.length}
      />

      {previewId && (
        <DocumentPreviewModal
          id={previewId}
          kind="doc"
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
            <Heading level={2} size="sm" id="rename-title">Rename document</Heading>
            <form className={styles['rename-form']} onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className={styles['rename-input']}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="New document name"
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
