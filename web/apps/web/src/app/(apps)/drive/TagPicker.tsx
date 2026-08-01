'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search, Tag as TagIcon } from 'lucide-react';
import { Spinner, Text, useToast } from '@neutrino/ui';
import { tagsApi, type Tag } from '@/lib/api';
import styles from './TagPicker.module.css';

/**
 * Tag writes need edit rights on the file — a viewer on a shared file gets a
 * 403. Say which it is rather than a generic failure.
 */
export function tagWriteErrorMessage(err: unknown, action: 'add' | 'remove'): string {
  if (errorStatus(err) === 403) return 'You need edit access to change tags on this file';
  return action === 'add' ? 'Could not add tag' : 'Could not remove tag';
}

function errorStatus(err: unknown): number | undefined {
  return (err as { statusCode?: number } | null)?.statusCode;
}

interface Props {
  fileId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tags currently on the file — owned by the caller so the panel and the
   *  picker always agree on what is checked. */
  appliedTags: Tag[];
}

/**
 * Applies the user's private tags to a single file.
 *
 * Renders inline (an expanding disclosure) rather than as a floating popover:
 * its host is the 300px file info panel, which scrolls and therefore clips
 * absolutely-positioned children at its own edges. Laying the picker out in
 * normal flow means no positioning math and nothing to clip.
 *
 * Writes go through the per-tag add/remove endpoints rather than the
 * replace-all PUT: toggling two tags quickly would otherwise race, with the
 * second request's payload built from a stale tag set.
 */
export function TagPicker({ fileId, open, onOpenChange, appliedTags }: Props) {
  const [query, setQuery] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape, as the popover version did. The trigger
  // lives inside `rootRef`, so clicking it toggles rather than double-firing.
  useEffect(() => {
    if (!open) return;

    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onOpenChange]);

  const { data: allTags, isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: () => tagsApi.list(),
    // The sidebar keeps this warm; filtering happens client-side so typing
    // costs no requests.
    staleTime: 30_000,
    enabled: open,
  });

  const appliedIds = useMemo(() => new Set(appliedTags.map((t) => t.id)), [appliedTags]);

  const trimmed = query.trim();
  const matches = useMemo(() => {
    const tags = allTags?.tags ?? [];
    if (!trimmed) return tags;
    const needle = trimmed.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(needle));
  }, [allTags, trimmed]);

  const exactMatch = matches.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['file-tags', fileId] });
    queryClient.invalidateQueries({ queryKey: ['tags'] });
    queryClient.invalidateQueries({ queryKey: ['tag-files'] });
  }

  const toggleMutation = useMutation({
    mutationFn: async ({ tag, applied }: { tag: Tag; applied: boolean }) => {
      if (applied) await tagsApi.removeFromFile(fileId, tag.id);
      else await tagsApi.addToFile(fileId, tag.id);
    },
    onMutate: async ({ tag, applied }) => {
      await queryClient.cancelQueries({ queryKey: ['file-tags', fileId] });
      const previous = queryClient.getQueryData<Tag[]>(['file-tags', fileId]);
      queryClient.setQueryData<Tag[]>(['file-tags', fileId], (current = []) =>
        applied
          ? current.filter((t) => t.id !== tag.id)
          : [...current, tag].sort((a, b) => a.name.localeCompare(b.name)),
      );
      return { previous };
    },
    onError: (err: unknown, { applied }, context) => {
      queryClient.setQueryData(['file-tags', fileId], context?.previous);
      toast.error(tagWriteErrorMessage(err, applied ? 'remove' : 'add'));
    },
    onSettled: invalidate,
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const tag = await tagsApi.create(name);
      await tagsApi.addToFile(fileId, tag.id);
      return tag;
    },
    onSuccess: (tag) => {
      setQuery('');
      toast.success(`Tagged with "${tag.name}"`);
    },
    onError: (err: unknown) => {
      toast.error(
        errorStatus(err) === 409
          ? 'A tag with that name already exists'
          : 'Could not create tag',
      );
    },
    onSettled: invalidate,
  });

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Plus size={11} aria-hidden />
        Add tag
      </button>

      {open && (
        <div className={styles.picker} role="dialog" aria-label="Manage tags">
          <div className={styles.searchRow}>
            <Search size={14} className={styles.searchIcon} aria-hidden />
            <input
              className={styles.searchInput}
              type="text"
              value={query}
              autoFocus
              placeholder="Find or create a tag"
              aria-label="Find or create a tag"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && trimmed && !exactMatch && !createMutation.isPending) {
                  createMutation.mutate(trimmed);
                }
              }}
            />
          </div>

          <div className={styles.list}>
            {isLoading && (
              <div className={styles.empty}>
                <Spinner size="sm" />
              </div>
            )}

            {!isLoading &&
              matches.map((tag) => {
                const applied = appliedIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="checkbox"
                    aria-checked={applied}
                    className={styles.option}
                    onClick={() => toggleMutation.mutate({ tag, applied })}
                  >
                    <span className={applied ? styles.checkOn : styles.checkOff} aria-hidden>
                      {applied && <Check size={12} />}
                    </span>
                    <TagIcon size={13} className={styles.tagIcon} aria-hidden />
                    <span className={styles.optionName}>{tag.name}</span>
                    <span className={styles.count}>{tag.fileCount}</span>
                  </button>
                );
              })}

            {!isLoading && matches.length === 0 && !trimmed && (
              <div className={styles.empty}>
                <Text size="xs" color="muted">
                  No tags yet. Type a name to create one.
                </Text>
              </div>
            )}
          </div>

          {trimmed && !exactMatch && (
            <button
              type="button"
              className={styles.createRow}
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate(trimmed)}
            >
              <Plus size={13} aria-hidden />
              <span>
                Create <strong>{trimmed}</strong>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
