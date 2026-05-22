'use client';
// Intentionally a full client component: the "New Presentation" and "Import PPTX"
// buttons, the hidden file input, and the FileGrid emptyState all share mutation and
// import-progress state, making the server shell (one Heading tag) too trivial to
// justify the split.

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Heading, useToast } from '@neutrino/ui';
import { FilePlus, Presentation, Upload } from 'lucide-react';
import {
  slidesApi,
  storageApi,
  filesystemApi,
  downloadAndDecryptFile,
  driveReadContent,
  driveCreateEncryptedVersion,
  encryptionApi,
  type SlideMetaResponse,
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
// importFromPptx (and its jszip dep) is loaded on-demand to keep the initial bundle lean
import styles from './page.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function slideToGridItem(slide: SlideMetaResponse): GridItem {
  return {
    id: slide.id,
    name: slide.title,
    kind: 'doc',
    icon: Presentation,
    iconColor: 'var(--color-rose, #e11d48)',
    subtitle: formatDate(slide.updatedAt),
    typeText: 'Presentation',
    modifiedText: formatDate(slide.updatedAt),
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

async function setupSlideE2EE(slideId: string, contentUrl: string, userId: string): Promise<void> {
  await initSodium();
  const kp = loadKeyPair(userId);
  if (!kp) return;
  const dek = generateFileKey();
  const encryptedFileKey = encryptFileKey(dek, kp.publicKey);
  const initialContent = await driveReadContent(contentUrl);
  await driveCreateEncryptedVersion(slideId, initialContent, 'slide.json', dek);
  await encryptionApi.setFileKey(slideId, { encryptedFileKey });
}

interface ContextMenuState {
  id: string;
  title: string;
  x: number;
  y: number;
}

export default function SlidesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currentUser = useUser();
  const [sortBy, setSortBy] = React.useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [contextFile, setContextFile] = React.useState<FileItem | null>(null);
  const [shareFile, setShareFile] = React.useState<FileItem | null>(null);
  const [infoFile, setInfoFile] = React.useState<FileItem | null>(null);
  const [moveFileId, setMoveFileId] = React.useState<string | null>(null);
  const [moveFileName, setMoveFileName] = React.useState('');
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['slides'],
    queryFn: () => slidesApi.listSlides(),
  });

  const createSlide = useMutation({
    mutationFn: async () => {
      const slide = await slidesApi.createSlide({ title: 'Untitled presentation' });
      const userId = currentUser?.id;
      if (userId) {
        try {
          await setupSlideE2EE(slide.id, slide.contentUrl, userId);
        } catch {
          // Non-fatal: editor falls back to plaintext if E2EE setup fails
        }
      }
      return slide;
    },
    onSuccess: (slide) => router.push(`/slides/editor?id=${slide.id}`),
  });

  const createAndImport = useMutation({
    mutationFn: async (file: File) => {
      const fileName = file.name.replace(/\.pptx$/i, '') || 'Imported presentation';
      const slide = await slidesApi.createSlide({ title: fileName });
      const { importFromPptx } = await import('./editor/pptxImport');
      await importFromPptx(file);
      await slidesApi.saveSlide(slide.id, { title: fileName });
      const userId = currentUser?.id;
      if (userId) {
        try {
          await setupSlideE2EE(slide.id, slide.contentUrl, userId);
        } catch {
          // Non-fatal
        }
      }
      return slide;
    },
    onSuccess: (slide) => router.push(`/slides/editor?id=${slide.id}`),
    onError: (err) => setImportError(err instanceof Error ? err.message : 'Import failed'),
    onSettled: () => setImporting(false),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      slidesApi.saveSlide(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slides'] });
      toast.success('Presentation renamed');
      setRenaming(null);
    },
    onError: () => toast.error('Failed to rename presentation'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => storageApi.deleteFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slides'] });
      toast.success('Presentation deleted');
    },
    onError: () => toast.error('Failed to delete presentation'),
  });

  const starMutation = useMutation({
    mutationFn: ({ id, isStarred }: { id: string; isStarred: boolean }) =>
      filesystemApi.updateFile(id, { isStarred }),
    onSuccess: (file) => {
      queryClient.invalidateQueries({ queryKey: ['slides'] });
      setContextFile(file);
      toast.success(file.isStarred ? 'Added to starred' : 'Removed from starred');
    },
    onError: () => toast.error('Failed to update starred status'),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, targetFolderId }: { id: string; targetFolderId: string | null }) =>
      filesystemApi.updateFile(id, { folderId: targetFolderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slides'] });
      toast.success('Presentation moved');
      setMoveFileId(null);
    },
    onError: () => toast.error('Failed to move presentation'),
  });

  async function handleImportFile(file: File) {
    setImportError(null);
    setImporting(true);
    createAndImport.mutate(file);
  }

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
        if (!userId) { toast.error('Failed to download presentation'); return; }
        await initSodium();
        const kp = loadKeyPair(userId);
        if (!kp) { toast.error('Encryption keys not found'); return; }
        const plaintext = await downloadAndDecryptFile(id, kp.publicKey, kp.secretKey);
        if (!plaintext) { toast.error('Failed to decrypt presentation'); return; }
        triggerBlobDownload(new Blob([plaintext.slice(0)]), `${title}.json`);
      } else {
        const blob = await storageApi.downloadFile(id);
        triggerBlobDownload(blob, `${title}.json`);
      }
    } catch {
      toast.error('Failed to download presentation');
    }
  }

  function handleCopyLink(id: string) {
    const url = `${window.location.origin}/slides/editor?id=${id}`;
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

  const slides = data?.slides ?? [];
  const gridItems: GridItem[] = slides.map(slideToGridItem);

  const menuFile: FileItem | null = contextFile ?? (contextMenu
    ? {
        id: contextMenu.id,
        name: contextMenu.title,
        sizeBytes: 0,
        mimeType: 'application/x-neutrino-slide',
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
      {/* Hidden file input */}
      <input
        ref={importInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImportFile(file);
          e.target.value = '';
        }}
      />

      <div className={styles.header}>
        <Heading level={1} size="xl">Presentations</Heading>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            variant="secondary"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            icon={<Upload size={16} />}
          >
            {importing ? 'Importing…' : 'Import PPTX'}
          </Button>
          <Button onClick={() => createSlide.mutate()} disabled={createSlide.isPending} icon={<FilePlus size={16} />}>
            New Presentation
          </Button>
        </div>
      </div>

      {importError && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-danger-subtle, #fef2f2)', border: '1px solid var(--color-danger, #dc2626)', borderRadius: 'var(--radius-md)', color: 'var(--color-danger, #dc2626)', fontSize: 'var(--font-size-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {importError}
          <button onClick={() => setImportError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>
      )}

      <FileGrid
        items={gridItems}
        isLoading={isLoading}
        isError={isError}
        emptyState={
          <EmptyState
            icon={FilePlus}
            title="No presentations yet"
            description="Create a new presentation to get started."
            action={
              <Button onClick={() => createSlide.mutate()} disabled={createSlide.isPending}>
                New Presentation
              </Button>
            }
          />
        }
        onItemClick={(item) => {
          router.push(`/slides/editor?id=${item.id}`);
        }}
        onItemMenuOpen={handleMenuOpen}
        showFilter={false}
        showSizeColumn={false}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : slides.length}
      />

      {previewId && (
        <DocumentPreviewModal
          id={previewId}
          kind="slide"
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
            <Heading level={2} size="sm" id="rename-title">Rename presentation</Heading>
            <form className={styles['rename-form']} onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className={styles['rename-input']}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="New presentation name"
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
