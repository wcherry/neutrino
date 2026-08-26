'use client';

import React, { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  EmptyState,
  FileGrid,
  Heading,
  Modal,
  ModalBody,
  ModalFooter,
  Text,
  TextInput,
  useToast,
  type GridItem,
  type SortDir,
  type SortField,
} from '@neutrino/ui';
import { ArrowLeft, Check, Pencil, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { tagsApi, type FileItem } from '@/lib/api';
import { fileToGridItem } from '../gridItems';
import { routeForFile } from '../routeForFile';
import { PreviewModal } from '../PreviewModal';
import styles from '../tags/tags.module.css';

/**
 * A tag is addressed by query string (`/drive/tag?id=…`) rather than a path
 * segment: the app ships as a static export, which cannot prerender a route
 * whose segments are user data.
 */
export default function TagDetailPage() {
  // `useSearchParams` needs a Suspense boundary above it during prerender.
  return (
    <Suspense fallback={null}>
      <TagDetail />
    </Suspense>
  );
}

function TagDetail() {
  const searchParams = useSearchParams();
  const tagId = searchParams.get('id') ?? '';
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const { data: tag, isLoading: tagLoading, isError: tagError } = useQuery({
    queryKey: ['tag', tagId],
    queryFn: () => tagsApi.get(tagId),
    enabled: Boolean(tagId),
  });

  const { data: filesData, isLoading: filesLoading } = useQuery({
    queryKey: ['tag-files', tagId],
    queryFn: () => tagsApi.filesForTag(tagId),
    enabled: Boolean(tagId),
  });

  const files = useMemo(() => filesData?.files ?? [], [filesData]);
  const items: GridItem[] = useMemo(() => files.map(fileToGridItem), [files]);

  const renameMutation = useMutation({
    mutationFn: (name: string) => tagsApi.rename(tagId, name),
    onSuccess: (updated) => {
      setRenaming(false);
      queryClient.setQueryData(['tag', tagId], updated);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      toast.success('Tag renamed');
    },
    onError: (err: unknown) => {
      const status = (err as { statusCode?: number } | null)?.statusCode;
      toast.error(
        status === 409 ? 'A tag with that name already exists' : 'Could not rename tag',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => tagsApi.remove(tagId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.removeQueries({ queryKey: ['tag', tagId] });
      queryClient.removeQueries({ queryKey: ['tag-files', tagId] });
      toast.success('Tag deleted');
      router.push('/drive/tags');
    },
    onError: () => toast.error('Could not delete tag'),
  });

  function openFile(item: GridItem) {
    const file = files.find((f) => f.id === item.id);
    if (!file) return;
    routeForFile(file, router, {
      onPreviewFallback: () => setPreviewFile(file),
    });
  }

  if (tagError || !tagId) {
    return (
      <div className={styles.page}>
        <EmptyState
          icon={TagIcon}
          title="Tag not found"
          description="This tag may have been deleted."
          action={<Button onClick={() => router.push('/drive/tags')}>All tags</Button>}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={() => router.back()}>
          <ArrowLeft size={16} />
          Back
        </button>

        <div className={styles.titleRow}>
          {renaming ? (
            <form
              className={styles.renameForm}
              onSubmit={(e) => {
                e.preventDefault();
                const name = draftName.trim();
                if (name && name !== tag?.name) renameMutation.mutate(name);
                else setRenaming(false);
              }}
            >
              <TextInput
                value={draftName}
                autoFocus
                aria-label="Tag name"
                fullWidth={false}
                onChange={(e) => setDraftName(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={renameMutation.isPending}>
                <Check size={14} />
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                <X size={14} />
              </Button>
            </form>
          ) : (
            <>
              <Heading level={1} size="xl">
                <TagIcon size={20} aria-hidden /> {tagLoading ? '…' : tag?.name}
              </Heading>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraftName(tag?.name ?? '');
                    setRenaming(true);
                  }}
                >
                  <Pencil size={14} />
                  Rename
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  <Trash2 size={14} />
                  Delete
                </Button>
              </div>
            </>
          )}
        </div>

        {!filesLoading && (
          <Text size="xs" color="muted">
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </Text>
        )}
      </div>

      <FileGrid
        items={items}
        isLoading={filesLoading}
        onItemClick={openFile}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={(field, dir) => {
          setSortBy(field);
          setSortDir(dir);
        }}
        totalCount={filesData?.total}
        emptyState={
          <EmptyState
            icon={TagIcon}
            title="Nothing tagged yet"
            description={`Files you tag with "${tag?.name ?? 'this tag'}" show up here.`}
          />
        }
      />

      {previewFile && <PreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete "${tag?.name ?? ''}"?`}
        size="sm"
      >
        <ModalBody>
          <Text size="sm">
            The tag is removed from every file it is on. The files themselves are not
            deleted.
          </Text>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            Delete tag
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
