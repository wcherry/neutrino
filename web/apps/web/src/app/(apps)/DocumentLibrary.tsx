'use client';

import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, FileGrid, Heading, useToast, type GridItem, type SortField, type SortDir } from '@neutrino/ui';
import { Eye, FilePlus, Link, Pencil, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DocumentPreviewModal, type DocumentKind } from '@/components/DocumentPreviewModal';
import styles from './DocumentLibrary.module.css';
import contextMenuStyles from './drive/FileContextMenu.module.css';

/** The subset of an app's metadata response the library needs to render a card. */
export interface LibraryItem {
  id: string;
  title: string;
  updatedAt: string;
}

export interface DocumentLibraryProps {
  /** Page heading, e.g. "Documents". */
  title: string;
  /** Lowercase singular used in buttons, dialogs and toasts, e.g. "document". */
  noun: string;
  /** Short label for the list view's Type column, e.g. "Doc". */
  typeText: string;
  icon: LucideIcon;
  iconColor: string;
  /** Editor route the cards link to, e.g. "/docs/editor". */
  editorPath: string;
  /** React Query cache key for the listing. */
  queryKey: string;
  /** Omit for apps the preview modal has no renderer for (drawings). */
  previewKind?: DocumentKind;
  fetchItems: () => Promise<LibraryItem[]>;
  createItem: () => Promise<{ id: string }>;
  renameItem: (id: string, title: string) => Promise<unknown>;
  deleteItem: (id: string) => Promise<unknown>;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface ContextMenuState {
  id: string;
  title: string;
  x: number;
  y: number;
}

interface LibraryContextMenuProps {
  x: number;
  y: number;
  noun: string;
  onClose: () => void;
  onPreview?: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}

function LibraryContextMenu({ x, y, noun, onClose, onPreview, onRename, onCopyLink, onDelete }: LibraryContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={contextMenuStyles.menu}
      style={{ left: x, top: y }}
      role="menu"
      aria-label={`${noun} options`}
    >
      {onPreview && (
        <button
          type="button"
          className={contextMenuStyles.item}
          role="menuitem"
          onClick={() => { onPreview(); onClose(); }}
        >
          <span className={contextMenuStyles.itemIcon}><Eye size={14} /></span>
          Preview
        </button>
      )}
      <button
        type="button"
        className={contextMenuStyles.item}
        role="menuitem"
        onClick={() => { onRename(); onClose(); }}
      >
        <span className={contextMenuStyles.itemIcon}><Pencil size={14} /></span>
        Rename
      </button>
      <button
        type="button"
        className={contextMenuStyles.item}
        role="menuitem"
        onClick={() => { onCopyLink(); onClose(); }}
      >
        <span className={contextMenuStyles.itemIcon}><Link size={14} /></span>
        Copy link
      </button>
      <div className={contextMenuStyles.separator} role="separator" />
      <button
        type="button"
        className={[contextMenuStyles.item, contextMenuStyles.danger].join(' ')}
        role="menuitem"
        onClick={() => { onDelete(); onClose(); }}
      >
        <span className={contextMenuStyles.itemIcon}><Trash2 size={14} /></span>
        Move to trash
      </button>
    </div>
  );
}

/**
 * The landing page every Office Suite app shares: a grid of the user's files
 * with create, rename, preview, copy-link and delete. Each app supplies its own
 * API calls and labels; nothing else differs between them.
 */
export function DocumentLibrary({
  title,
  noun,
  typeText,
  icon,
  iconColor,
  editorPath,
  queryKey,
  previewKind,
  fetchItems,
  createItem,
  renameItem,
  deleteItem,
}: DocumentLibraryProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [sortBy, setSortBy] = React.useState<SortField>('updatedAt');
  const [sortDir, setSortDir] = React.useState<SortDir>('desc');
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = React.useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const newLabel = `New ${noun}`;

  React.useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const { data, isLoading, isError } = useQuery({
    queryKey: [queryKey],
    queryFn: fetchItems,
  });

  const createMutation = useMutation({
    mutationFn: createItem,
    onSuccess: (created) => router.push(`${editorPath}?id=${created.id}`),
    onError: () => toast.error(`Failed to create ${noun}`),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title: newTitle }: { id: string; title: string }) => renameItem(id, newTitle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast.success(`${capitalize(noun)} renamed`);
      setRenaming(null);
    },
    onError: () => toast.error(`Failed to rename ${noun}`),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast.success(`${capitalize(noun)} deleted`);
    },
    onError: () => toast.error(`Failed to delete ${noun}`),
  });

  function handleMenuOpen(item: GridItem, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right, window.innerWidth - 200);
    const y = Math.min(rect.bottom, window.innerHeight - 200);
    setContextMenu({ id: item.id, title: item.name, x, y });
  }

  function handleCopyLink(id: string) {
    const url = `${window.location.origin}${editorPath}?id=${id}`;
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

  const items = data ?? [];
  const gridItems: GridItem[] = items.map((item) => ({
    id: item.id,
    name: item.title,
    kind: 'doc',
    icon,
    iconColor,
    subtitle: formatDate(item.updatedAt),
    typeText,
    modifiedText: formatDate(item.updatedAt),
  }));

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">{title}</Heading>
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} icon={<FilePlus size={16} />}>
          {newLabel}
        </Button>
      </div>

      <FileGrid
        items={gridItems}
        isLoading={isLoading}
        isError={isError}
        emptyState={
          <EmptyState
            icon={icon}
            title={`No ${noun}s yet`}
            description={`Create a new ${noun} to get started.`}
            action={
              <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} icon={<FilePlus size={16} />}>
                {newLabel}
              </Button>
            }
          />
        }
        onItemClick={(item) => router.push(`${editorPath}?id=${item.id}`)}
        onItemMenuOpen={handleMenuOpen}
        showFilter={false}
        showSizeColumn={false}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : items.length}
      />

      {previewId && previewKind && (
        <DocumentPreviewModal
          id={previewId}
          kind={previewKind}
          onClose={() => setPreviewId(null)}
        />
      )}

      {contextMenu && (
        <LibraryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          noun={noun}
          onClose={() => setContextMenu(null)}
          onPreview={previewKind ? () => {
            setPreviewId(contextMenu.id);
            setContextMenu(null);
          } : undefined}
          onRename={() => {
            setRenameValue(contextMenu.title);
            setRenaming({ id: contextMenu.id, title: contextMenu.title });
            setContextMenu(null);
          }}
          onCopyLink={() => handleCopyLink(contextMenu.id)}
          onDelete={() => deleteMutation.mutate(contextMenu.id)}
        />
      )}

      {renaming && (
        <div className={styles['rename-overlay']} onClick={() => setRenaming(null)}>
          <div
            className={styles['rename-dialog']}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-title"
          >
            <Heading level={2} size="sm" id="rename-title">Rename {noun}</Heading>
            <form className={styles['rename-form']} onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className={styles['rename-input']}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label={`New ${noun} name`}
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
