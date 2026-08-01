'use client';

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  History,
  Calendar,
  HardDrive,
  Tag,
} from 'lucide-react';
import { Text, Heading, Spinner, useToast } from '@neutrino/ui';
import { storageApi, tagsApi, type FileItem, type Tag as TagType } from '@/lib/api';
import { getFileIcon, getIconColor } from '@/lib/file-icons';
import { TagPicker, tagWriteErrorMessage } from './TagPicker';
import styles from './FileInfoPanel.module.css';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}


interface Props {
  file: FileItem;
  onClose: () => void;
  /** Opens with the tag picker already showing — used by "Manage tags". */
  focusTags?: boolean;
}

export function FileInfoPanel({ file, onClose, focusTags = false }: Props) {
  const [pickerOpen, setPickerOpen] = useState(focusTags);
  const queryClient = useQueryClient();
  const toast = useToast();

  const { data: versionsData, isLoading: versionsLoading } = useQuery({
    queryKey: ['file-versions', file.id],
    queryFn: () => storageApi.listVersions(file.id),
    staleTime: 60_000,
  });

  const { data: tags, isLoading: tagsLoading } = useQuery({
    queryKey: ['file-tags', file.id],
    queryFn: () => tagsApi.forFile(file.id),
    staleTime: 30_000,
  });

  const removeTagMutation = useMutation({
    mutationFn: (tag: TagType) => tagsApi.removeFromFile(file.id, tag.id),
    onMutate: async (tag) => {
      await queryClient.cancelQueries({ queryKey: ['file-tags', file.id] });
      const previous = queryClient.getQueryData<TagType[]>(['file-tags', file.id]);
      queryClient.setQueryData<TagType[]>(['file-tags', file.id], (current = []) =>
        current.filter((t) => t.id !== tag.id),
      );
      return { previous };
    },
    onError: (err, _tag, context) => {
      queryClient.setQueryData(['file-tags', file.id], context?.previous);
      toast.error(tagWriteErrorMessage(err, 'remove'));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['file-tags', file.id] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      queryClient.invalidateQueries({ queryKey: ['tag-files'] });
    },
  });

  const IconComponent = getFileIcon(file.mimeType);
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toUpperCase() : 'Unknown';

  return (
    <aside className={styles.panel} aria-label="File information">
      <div className={styles.header}>
        <Heading level={3} size="sm">File info</Heading>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close file info"
        >
          <X size={16} />
        </button>
      </div>

      <div className={styles.iconArea}>
        <div className={styles.fileIcon} style={{ color: getIconColor(file.mimeType) }}>
          <IconComponent size={48} strokeWidth={1} />
        </div>
        <Text weight="medium" size="sm" truncate >
          {file.name}
        </Text>
      </div>

      <div className={styles.section}>
        <Text
          size="xs"
          color="muted"
          weight="semibold"
        >
          Details
        </Text>
        <dl className={styles.list}>
          <div className={styles.row}>
            <dt>
              <HardDrive size={13} />
              Size
            </dt>
            <dd>{formatFileSize(file.sizeBytes)}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <Tag size={13} />
              Type
            </dt>
            <dd>{ext}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <Calendar size={13} />
              Created
            </dt>
            <dd>{formatDate(file.createdAt)}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <Calendar size={13} />
              Modified
            </dt>
            <dd>{formatDate(file.updatedAt)}</dd>
          </div>
          <div className={styles.row}>
            <dt>
              <History size={13} />
              Versions
            </dt>
            <dd>
              {versionsLoading ? (
                <Spinner size="sm" />
              ) : (
                versionsData?.total ?? 0
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div className={styles.section}>
        <Text
          size="xs"
          color="muted"
          weight="semibold"
        >
          Tags
        </Text>
        {tagsLoading ? (
          <Spinner size="sm" />
        ) : (
          <div className={styles.tagSection}>
            {(tags ?? []).length > 0 && (
              <div className={styles.tagList}>
                {(tags ?? []).map((tag) => (
                  <span key={tag.id} className={styles.tagChip}>
                    <Tag size={11} aria-hidden />
                    {tag.name}
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={`Remove tag ${tag.name}`}
                      onClick={() => removeTagMutation.mutate(tag)}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <TagPicker
              fileId={file.id}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              appliedTags={tags ?? []}
            />
          </div>
        )}
      </div>

      <div className={styles.section}>
        <Text
          size="xs"
          color="muted"
          weight="semibold"
        >
          MIME type
        </Text>
        <Text size="xs" color="muted">
          {file.mimeType}
        </Text>
      </div>
    </aside>
  );
}
