'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  Skeleton,
  Text,
  TextInput,
  useToast,
} from '@neutrino/ui';
import { ArrowLeft, Check, Pencil, Plus, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { tagsApi, type Tag } from '@/lib/api';
import styles from './tags.module.css';

export default function TagsPage() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Tag | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
  });

  // Most-used first, matching the sidebar's ordering.
  const tags = [...(data?.tags ?? [])].sort(
    (a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name),
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['tags'] });
  }

  function reportWriteError(err: unknown, fallback: string) {
    const status = (err as { statusCode?: number } | null)?.statusCode;
    toast.error(status === 409 ? 'A tag with that name already exists' : fallback);
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => tagsApi.create(name),
    onSuccess: () => {
      setNewName('');
      invalidate();
      toast.success('Tag created');
    },
    onError: (err) => reportWriteError(err, 'Could not create tag'),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => tagsApi.rename(id, name),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError: (err) => reportWriteError(err, 'Could not rename tag'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => tagsApi.remove(id),
    onSuccess: () => {
      setPendingDelete(null);
      invalidate();
      toast.success('Tag deleted');
    },
    onError: () => toast.error('Could not delete tag'),
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => router.back()}>
          <ArrowLeft size={16} />
          Back
        </button>
        <Heading level={1} size="xl">Tags</Heading>
        <Text size="xs" color="muted">
          Tags are private to you — collaborators on a shared file never see them.
        </Text>
      </div>

      <form
        className={styles.createForm}
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (name) createMutation.mutate(name);
        }}
      >
        <TextInput
          value={newName}
          placeholder="New tag name"
          aria-label="New tag name"
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" disabled={!newName.trim() || createMutation.isPending}>
          <Plus size={14} />
          Create
        </Button>
      </form>

      {isLoading && <Skeleton height="120px" />}

      {!isLoading && tags.length === 0 && (
        <EmptyState
          icon={TagIcon}
          title="No tags yet"
          description="Create a tag above, or tag a file from its context menu in Drive."
        />
      )}

      {tags.length > 0 && (
        <ul className={styles.tagList}>
          {tags.map((tag) => (
            <li key={tag.id} className={styles.tagRow}>
              {editingId === tag.id ? (
                <form
                  className={styles.renameForm}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = draftName.trim();
                    if (name && name !== tag.name) renameMutation.mutate({ id: tag.id, name });
                    else setEditingId(null);
                  }}
                >
                  <TextInput
                    value={draftName}
                    autoFocus
                    aria-label={`Rename ${tag.name}`}
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={renameMutation.isPending}>
                    <Check size={14} />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </Button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.tagLink}
                    onClick={() => router.push(`/drive/tags/${tag.id}`)}
                  >
                    <TagIcon size={14} aria-hidden />
                    <span className={styles.tagName}>{tag.name}</span>
                    <span className={styles.tagCount}>
                      {tag.fileCount} {tag.fileCount === 1 ? 'file' : 'files'}
                    </span>
                  </button>
                  <div className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Rename ${tag.name}`}
                      onClick={() => {
                        setDraftName(tag.name);
                        setEditingId(tag.id);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete ${tag.name}`}
                      onClick={() => setPendingDelete(tag)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={`Delete "${pendingDelete?.name ?? ''}"?`}
        size="sm"
      >
        <ModalBody>
          <Text size="sm">
            The tag is removed from every file it is on. The files themselves are not
            deleted.
          </Text>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
          >
            Delete tag
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
