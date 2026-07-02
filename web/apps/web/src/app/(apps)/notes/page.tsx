'use client';

import React, { useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, Heading, useToast } from '@neutrino/ui';
import { FilePlus, NotebookPen, Pencil, Link, Trash2 } from 'lucide-react';
import { notesApi, type NoteMetaResponse } from '@/lib/api';
import { FileGrid, type GridItem, type SortField, type SortDir } from '@neutrino/ui';
import { DocumentPreviewModal } from '@/components/DocumentPreviewModal';
import styles from './page.module.css';
import contextMenuStyles from '../drive/FileContextMenu.module.css';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function noteToGridItem(note: NoteMetaResponse): GridItem {
  return {
    id: note.id,
    name: note.title,
    kind: 'doc',
    icon: NotebookPen,
    iconColor: 'var(--color-orange, #ea580c)',
    subtitle: formatDate(note.updatedAt),
    typeText: 'Note',
    modifiedText: formatDate(note.updatedAt),
  };
}

interface NoteContextMenuProps {
  id: string;
  title: string;
  x: number;
  y: number;
  onClose: () => void;
  onPreview?: () => void;
  onRename: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}

function NoteContextMenu({ id: _id, title: _title, x, y, onClose, onPreview, onRename, onCopyLink, onDelete }: NoteContextMenuProps) {
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

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return (
    <div
      ref={ref}
      className={contextMenuStyles.menu}
      style={{ left: adjustedX, top: adjustedY }}
      role="menu"
      aria-label="Note options"
    >
      {onPreview && (
        <button
          type="button"
          className={contextMenuStyles.item}
          role="menuitem"
          onClick={() => { onPreview(); onClose(); }}
        >
          <span className={contextMenuStyles.itemIcon}><FilePlus size={14} /></span>
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

interface ContextMenuState {
  id: string;
  title: string;
  x: number;
  y: number;
}

export default function NotesPage() {
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

  React.useEffect(() => {
    if (renaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renaming]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['notes'],
    queryFn: () => notesApi.listNotes(),
  });

  const createNote = useMutation({
    mutationFn: () => notesApi.createNote({ title: 'Untitled note' }),
    onSuccess: (note) => router.push(`/notes/editor?id=${note.id}`),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const note = await notesApi.getNote(id);
      return notesApi.saveNote(id, { content: note.content, title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Note renamed');
      setRenaming(null);
    },
    onError: () => toast.error('Failed to rename note'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notesApi.deleteNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      toast.success('Note deleted');
    },
    onError: () => toast.error('Failed to delete note'),
  });

  function handleMenuOpen(item: GridItem, e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(rect.right, window.innerWidth - 200);
    const y = Math.min(rect.bottom, window.innerHeight - 200);
    setContextMenu({ id: item.id, title: item.name, x, y });
  }

  function handleCopyLink(id: string) {
    const url = `${window.location.origin}/notes/editor?id=${id}`;
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

  const notes = data?.notes ?? [];
  const gridItems: GridItem[] = notes.map(noteToGridItem);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <Heading level={1} size="xl">Notes</Heading>
        <Button onClick={() => createNote.mutate()} disabled={createNote.isPending} icon={<FilePlus size={16} />}>
          New Note
        </Button>
      </div>

      <FileGrid
        items={gridItems}
        isLoading={isLoading}
        isError={isError}
        emptyState={
          <EmptyState
            icon={FilePlus}
            title="No notes yet"
            description="Create a new note to get started."
            action={
              <Button onClick={() => createNote.mutate()} disabled={createNote.isPending} icon={<FilePlus size={16} />}>
                New Note
              </Button>
            }
          />
        }
        onItemClick={(item) => {
          router.push(`/notes/editor?id=${item.id}`);
        }}
        onItemMenuOpen={handleMenuOpen}
        showFilter={false}
        showSizeColumn={false}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => { setSortBy(field); setSortDir(dir); }}
        totalCount={isLoading ? undefined : notes.length}
      />

      {previewId && (
        <DocumentPreviewModal
          id={previewId}
          kind="note"
          onClose={() => setPreviewId(null)}
        />
      )}

      {contextMenu && (
        <NoteContextMenu
          id={contextMenu.id}
          title={contextMenu.title}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPreview={() => {
            setPreviewId(contextMenu.id);
            setContextMenu(null);
          }}
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
            <Heading level={2} size="sm" id="rename-title">Rename note</Heading>
            <form className={styles['rename-form']} onSubmit={handleRenameSubmit}>
              <input
                ref={renameInputRef}
                className={styles['rename-input']}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                aria-label="New note name"
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
